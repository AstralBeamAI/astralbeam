import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { Microsandbox } from "@astralbeam/sandbox"

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "astralbeam-microsandbox-provider-"))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(directory, { recursive: true, force: true })
})

async function microsandboxFixture(fixture: {
  created: Promise<unknown>
  connect?: () => Promise<unknown>
}) {
  vi.stubGlobal("__microsandboxTest", fixture)
  const sdkPath = join(directory, "sdk.mjs")
  await writeFile(
    sdkPath,
    `export function setDefaultBackend() {}
    const fixture = globalThis.__microsandboxTest;
    const builder = { imageWith() { return this }, envs() { return this }, detached() { return this }, maxDuration() { return this }, create: () => fixture.created };
    export const Sandbox = { builder: () => builder, get: async () => ({ connectOrStart: fixture.connect }) };
    export class SandboxNotFoundError extends Error {};`,
  )
  return new Microsandbox({ sdkPath, image: "python:3.13-slim" }).provider
}

it("terminates a process with unread output without blocking wait or cleanup", async () => {
  const output = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>()
  const disposed = vi.fn(() => Promise.resolve())
  const execution = {
    recv: () => Promise.resolve({ kind: "started", pid: 1 }),
    takeStdin: () =>
      Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
    async *[Symbol.asyncIterator]() {
      output.resolve()
      yield { kind: "stdout", data: new Uint8Array(512 * 1024) }
      await stopped.promise
      yield { kind: "exited", code: 137 }
    },
    kill: () => {
      stopped.resolve()
      return Promise.resolve()
    },
    [Symbol.asyncDispose]: disposed,
  }
  const sandbox = {
    name: "fixture",
    fs: () => ({ mkdir: () => Promise.resolve() }),
    execStreamWith: () => Promise.resolve(execution),
  }
  const provider = await microsandboxFixture({ created: Promise.resolve(sandbox) })
  const handle = await provider.create({})
  const command = await handle.process.spawn("noisy-command")
  await output.promise
  await command.kill()

  await expect(command.wait()).resolves.toBe(137)
  expect(disposed).toHaveBeenCalledExactlyOnceWith()
})

it("reclaims interrupted creation but preserves an existing sandbox on interrupted resume", async () => {
  const created = Promise.withResolvers<unknown>()
  const connecting = Promise.withResolvers<void>()
  const resumed = Promise.withResolvers<unknown>()
  const sandbox = {
    name: "fixture",
    fs: () => ({ mkdir: () => Promise.resolve() }),
    destroy: vi.fn(() => Promise.resolve()),
  }
  const provider = await microsandboxFixture({
    created: created.promise,
    connect: () => {
      connecting.resolve()
      return resumed.promise
    },
  })
  const controller = new AbortController()
  const pending = provider.create({ signal: controller.signal })
  controller.abort()

  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  created.resolve(sandbox)
  await vi.waitFor(() => expect(sandbox.destroy).toHaveBeenCalledExactlyOnceWith({ force: true }))

  const resumeController = new AbortController()
  const reconnect = provider.resume({ id: sandbox.name, signal: resumeController.signal })
  await connecting.promise
  resumeController.abort()
  resumed.resolve(sandbox)
  await expect(reconnect).rejects.toMatchObject({ name: "AbortError" })
  expect(sandbox.destroy).toHaveBeenCalledTimes(1)
})
