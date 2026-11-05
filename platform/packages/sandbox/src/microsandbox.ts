import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { constants } from "node:os"
import { posix } from "node:path"
import { PassThrough } from "node:stream"
import { pathToFileURL } from "node:url"

import {
  createExecBackedGit,
  UnsupportedCapabilityError,
  type ProcessOptions,
  type SandboxCapabilities,
  type SandboxFsOptions,
  type SandboxFsStat,
  type SandboxHandle,
  type SandboxProvider,
  type SpawnHandle,
} from "@tanstack/ai-sandbox"
import type { Sandbox } from "microsandbox"
import { SandboxConnection, microsandboxAvailable } from "./checks.ts"

const microsandboxCapabilities: SandboxCapabilities = {
  fs: true,
  exec: true,
  env: true,
  ports: false,
  backgroundProcesses: true,
  writableStdin: true,
  killableProcesses: true,
  snapshots: false,
  networkPolicy: false,
  durableFilesystem: true,
  fork: false,
}
const MICROSANDBOX_MAX_TRANSFER_BYTES = 16 * 1024 * 1024
const MICROSANDBOX_MAX_COMMAND_CHARACTERS = 1024 * 1024

async function microsandboxFsCall<A>(
  options: SandboxFsOptions | undefined,
  operation: () => Promise<A>,
): Promise<A> {
  options?.signal?.throwIfAborted()
  const result = await operation()
  options?.signal?.throwIfAborted()
  return result
}

async function acquireMicrosandbox<A>(
  pending: Promise<A>,
  signal: AbortSignal | undefined,
  release: (value: A) => Promise<void>,
): Promise<A> {
  // Keep native work in the caller's capacity budget until acquisition and cleanup settle.
  const result = await pending
  if (signal?.aborted) {
    await release(result)
    signal.throwIfAborted()
  }
  return result
}

async function spawnMicrosandboxCommand(
  sandbox: Sandbox,
  command: string,
  environment: Record<string, string>,
  options: ProcessOptions = {},
): Promise<SpawnHandle> {
  options.signal?.throwIfAborted()
  const execution = await acquireMicrosandbox(
    sandbox.execStreamWith("sh", (builder) =>
      builder
        .args(["-c", command])
        .cwd(options.cwd ?? "/workspace")
        .envs({ ...environment, ...options.env })
        .stdinPipe(),
    ),
    options.signal,
    (handle) => handle.kill(),
  )
  const stdout = new PassThrough().setEncoding("utf8")
  const stderr = new PassThrough().setEncoding("utf8")
  stdout.on("error", () => {})
  stderr.on("error", () => {})
  const abort = () => {
    const reason: unknown = options.signal?.reason
    const error =
      reason instanceof Error ? reason : new DOMException("Command aborted", "AbortError")
    stdout.destroy(error)
    stderr.destroy(error)
    void execution.kill().catch(() => undefined)
  }
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    const first = await execution.recv()
    const stdin = await execution.takeStdin()
    if (first?.kind !== "started" || !stdin) {
      throw new Error("Microsandbox did not start a command")
    }
    const completed = (async () => {
      try {
        for await (const event of execution) {
          options.signal?.throwIfAborted()
          if (event.kind === "exited") return event.code
          if (event.kind === "stdout" || event.kind === "stderr") {
            const output = event.kind === "stdout" ? stdout : stderr
            if (!output.write(event.data)) await once(output, "drain")
          }
        }
        throw new Error("Microsandbox command ended without an exit status")
      } finally {
        options.signal?.removeEventListener("abort", abort)
        stdout.end()
        stderr.end()
        await execution[Symbol.asyncDispose]()
      }
    })()
    // The caller may consume streams before awaiting the exit status.
    void completed.catch(() => undefined)
    return {
      pid: first.pid,
      stdout: stdout as AsyncIterable<string>,
      stderr: stderr as AsyncIterable<string>,
      stdin: { write: (data) => stdin.write(data), end: () => stdin.close() },
      wait: () => completed,
      kill: async (signal) => {
        await (signal === undefined
          ? execution.kill()
          : execution.signal(typeof signal === "number" ? signal : constants.signals[signal]))
        // Drain unread output on termination so backpressure cannot hold cleanup open.
        stdout.resume()
        stderr.resume()
      },
    }
  } catch (error) {
    options.signal?.removeEventListener("abort", abort)
    await execution[Symbol.asyncDispose]()
    throw error
  }
}

async function collectMicrosandboxCommand(handle: SpawnHandle) {
  let characters = 0
  const collect = async (stream: AsyncIterable<string>) => {
    let output = ""
    for await (const chunk of stream) {
      characters += chunk.length
      if (characters > MICROSANDBOX_MAX_COMMAND_CHARACTERS)
        throw new Error("Microsandbox command output limit exceeded")
      output += chunk
    }
    return output
  }
  try {
    await handle.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([
      collect(handle.stdout),
      collect(handle.stderr),
      handle.wait(),
    ])
    return { stdout, stderr, exitCode }
  } finally {
    await handle.kill().catch(() => undefined)
  }
}

function wrapMicrosandbox(sandbox: Sandbox): SandboxHandle {
  const fs = sandbox.fs()
  const environment: Record<string, string> = {}
  const process = {
    spawn: (command: string, options?: ProcessOptions) =>
      spawnMicrosandboxCommand(sandbox, command, environment, options),
    exec: async (command: string, options?: ProcessOptions) =>
      collectMicrosandboxCommand(
        await spawnMicrosandboxCommand(sandbox, command, environment, options),
      ),
  }
  const readBytes = (path: string, options?: SandboxFsOptions) =>
    microsandboxFsCall(options, async () => {
      await using stream = await fs.readStream(path)
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of stream) {
        options?.signal?.throwIfAborted()
        size += chunk.byteLength
        if (size > MICROSANDBOX_MAX_TRANSFER_BYTES)
          throw new Error("Microsandbox file transfer limit exceeded")
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    })
  // SDK stat follows links. Replace this directory lookup when the JS SDK exposes lstat.
  // https://github.com/superradcompany/microsandbox/blob/v0.7.13/sdk/rust/lib/sandbox/fs.rs#L1572
  const lstat = (path: string, options?: SandboxFsOptions) =>
    microsandboxFsCall<SandboxFsStat | undefined>(options, async () => {
      if (path === "/") return { type: "dir", mode: (await fs.stat(path)).mode }
      const entries = await fs.list(posix.dirname(path))
      const entry = entries.find((item) => posix.basename(item.path) === posix.basename(path))
      if (!entry) return undefined
      const type = entry.kind === "directory" ? "dir" : entry.kind
      return { type, mode: entry.mode, size: entry.size }
    })
  return {
    id: sandbox.name,
    provider: "microsandbox",
    workspaceRoot: "/workspace",
    capabilities: microsandboxCapabilities,
    process,
    git: createExecBackedGit(process, "/workspace"),
    fs: {
      read: async (path, options) => new TextDecoder().decode(await readBytes(path, options)),
      readBytes,
      write: (path, data, options) => microsandboxFsCall(options, () => fs.write(path, data)),
      list: (path, options) =>
        microsandboxFsCall(options, async () =>
          (await fs.list(path)).map((entry) => ({
            name: posix.basename(entry.path),
            path: entry.path,
            type: entry.kind === "directory" ? ("dir" as const) : ("file" as const),
          })),
        ),
      mkdir: (path, options) => microsandboxFsCall(options, () => fs.mkdir(path)),
      remove: (path, options) =>
        microsandboxFsCall(options, async () =>
          (await lstat(path, options))?.type === "dir" ? fs.removeDir(path) : fs.remove(path),
        ),
      rename: (from, to, options) => microsandboxFsCall(options, () => fs.rename(from, to)),
      exists: (path, options) => microsandboxFsCall(options, () => fs.exists(path)),
      lstat,
    },
    ports: {
      connect: () => Promise.reject(new UnsupportedCapabilityError("microsandbox", "ports")),
    },
    env: {
      set: (vars) => {
        Object.assign(environment, vars)
        return Promise.resolve()
      },
    },
    destroy: () => sandbox.destroy({ force: true }),
  }
}

/** A local microVM provider using the SDK and runtime approved at Platform startup. */
async function microsandboxSandbox(config: {
  sdkPath: string
  image: string
}): Promise<SandboxProvider> {
  const sdk = (await import(
    /* @vite-ignore */ pathToFileURL(config.sdkPath).href
  )) as typeof import("microsandbox")
  sdk.setDefaultBackend("local")
  const destroy = async (id: string) => {
    try {
      await (await sdk.Sandbox.get(id)).destroy({ force: true })
    } catch (error) {
      if (!(error instanceof sdk.SandboxNotFoundError)) throw error
    }
  }
  return {
    name: "microsandbox",
    capabilities: () => microsandboxCapabilities,
    create: async (input) => {
      input.signal?.throwIfAborted()
      const id = `astralbeam-${randomUUID()}`
      const pending = (async () => {
        try {
          const sandbox = await sdk.Sandbox.builder(id)
            // An explicit OCI source prevents an organization from mounting a host path as an image.
            .imageWith((image: InstanceType<typeof sdk.ImageBuilder>) => image.oci(config.image))
            .envs(input.env ?? {})
            .detached(true)
            .maxDuration(3600)
            .create()
          await sandbox.fs().mkdir("/workspace")
          return wrapMicrosandbox(sandbox)
        } catch (error) {
          await destroy(id)
          throw error
        }
      })()
      return acquireMicrosandbox(pending, input.signal, (handle) => handle.destroy())
    },
    resume: async (input) => {
      input.signal?.throwIfAborted()
      try {
        const handle = await sdk.Sandbox.get(input.id)
        const sandbox = await handle.connectOrStart({ detached: true })
        input.signal?.throwIfAborted()
        return wrapMicrosandbox(sandbox)
      } catch (error) {
        if (error instanceof sdk.SandboxNotFoundError) return null
        throw error
      }
    },
    destroy: async (input) => {
      input.signal?.throwIfAborted()
      await destroy(input.id)
    },
  }
}

export class Microsandbox extends SandboxConnection {
  constructor(config: { sdkPath: string; image: string }) {
    super(() => microsandboxSandbox(config))
  }

  static override available(): Promise<boolean> {
    return microsandboxAvailable()
  }
}
