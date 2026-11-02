import "@tanstack/react-start/server-only"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import { Cause, Effect, Exit, Result, Schedule, Schema } from "effect"
import { defineServerEntry } from "nitro"

const workerCountSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
)

/** @knipignore Nitro loads these server options. */
export default defineServerEntry({
  // Model and tool requests can remain quiet longer than Bun's default idle timeout.
  // https://nitro.build/docs/server-entry#server-options
  bun: { idleTimeout: 0 },
  reusePort:
    process.platform === "linux" && process.env.__ASTRALBEAM_INTERNAL_WORKER_ID !== undefined,
  gracefulShutdown: true,
})

function resolvePlatformWorkerCount(): number {
  const value = process.env.WORKERS ?? "auto"
  if (value === "auto") return process.platform === "linux" ? availableParallelism() : 1
  const count = Schema.decodeUnknownResult(workerCountSchema)(value)
  if (Result.isFailure(count)) throw new Error("WORKERS must be auto or a positive integer")
  if (process.platform !== "linux" && count.success > 1) {
    throw new Error("Multiple HTTP workers require Linux. Use WORKERS=1 on macOS and Windows")
  }
  return count.success
}

export async function startPlatformServer(): Promise<number> {
  const count = resolvePlatformWorkerCount()
  const isWorker = process.env.__ASTRALBEAM_INTERNAL_WORKER_ID !== undefined
  if (!isWorker) console.error(`Starting ${count} server workers`)
  if (count > 1) {
    if (process.env.CLUSTER_RUNNER_PORT && process.env.CLUSTER_RUNNER_PORT !== "0") {
      throw new Error("Multiple workers require CLUSTER_RUNNER_PORT=0 for distinct private ports")
    }
    if (
      process.env.NITRO_UNIX_SOCKET ||
      Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "") === 0
    ) {
      throw new Error("Multiple workers require a fixed public TCP port")
    }
    const command = Bun.isStandaloneExecutable
      ? [process.execPath, "start"]
      : [process.execPath, fileURLToPath(new URL("./src/main.ts", import.meta.url)), "start"]
    BunRuntime.runMain(supervisePlatformWorkers({ count, command }), {
      teardown: (exit, onExit) =>
        onExit(Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause) ? 1 : 0),
    })
    return 0
  }
  if (isWorker && !process.connected) return 0
  const stopDuringStartup = (signal: NodeJS.Signals) => {
    // Run exit cleanup before Nitro installs its own graceful shutdown handlers.
    if (process.listenerCount(signal) === 1) process.exit(0)
  }
  process.on("SIGTERM", stopDuringStartup)
  process.on("SIGINT", stopDuringStartup)
  // IPC disconnect also shuts down orphaned workers if the supervisor is killed.
  if (process.connected) process.once("disconnect", () => process.kill(process.pid, "SIGTERM"))
  try {
    // Keep server initialization lazy so version and migration commands need no running server.
    let serverUrl = new URL("./.output/server/index.mjs", import.meta.url)
    if (Bun.isStandaloneExecutable) {
      // Nitro's traced packages need real paths for package exports and native libraries.
      // https://bun.sh/docs/bundler/executables#listing-embedded-files
      const directory = mkdtempSync(join(tmpdir(), "astralbeam-platform-"))
      process.once("exit", () => rmSync(directory, { recursive: true, force: true }))
      for (const file of Bun.embeddedFiles) {
        const { name } = file as Blob & { name: string }
        if (name.startsWith("server/") || name.startsWith("public/")) {
          const destination = join(directory, name)
          mkdirSync(dirname(destination), { recursive: true })
          writeFileSync(destination, new Uint8Array(await file.arrayBuffer()))
        }
      }
      serverUrl = pathToFileURL(join(directory, "server/index.mjs"))
    }
    await import(/* @vite-ignore */ serverUrl.href)
  } finally {
    process.off("SIGTERM", stopDuringStartup)
    process.off("SIGINT", stopDuringStartup)
  }
  return 0
}

function launchPlatformWorker(command: readonly string[], worker: number) {
  const child = Bun.spawn([...command], {
    // Internal supervisor marker, not an operator setting. Configure worker count with WORKERS.
    env: { ...process.env, WORKERS: "1", __ASTRALBEAM_INTERNAL_WORKER_ID: String(worker) },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    // Opening IPC lets workers detect supervisor death.
    ipc: () => undefined,
  })
  console.error(`Started worker ${worker} (PID ${child.pid})`)
  return { child, exited: Effect.promise(() => child.exited) }
}

/** Each slot owns its child's lifetime, including interruption while waiting to restart. */
export function supervisePlatformWorkers(options: {
  readonly count: number
  readonly command: readonly string[]
}) {
  const workerSlot = (worker: number) =>
    Effect.acquireUseRelease(
      Effect.try(() => launchPlatformWorker(options.command, worker)),
      ({ exited }) =>
        Effect.gen(function* () {
          const code = yield* exited
          console.error(`Worker ${worker} exited (${code}), restarting with backoff`)
          return yield* Effect.fail(new Error("Worker exited"))
        }),
      ({ child, exited }) =>
        Effect.gen(function* () {
          if (child.exitCode !== null || child.signalCode !== null) return
          child.kill("SIGTERM")
          const result = yield* exited.pipe(Effect.timeoutOption("12 seconds"))
          if (result._tag === "None") {
            child.kill("SIGKILL")
            yield* exited
          }
          // Shutdown can reach a newly spawned worker before it installs signal handlers.
          if (result._tag === "None" || (result.value !== 0 && child.signalCode !== "SIGTERM"))
            return yield* Effect.die("Worker shutdown failed or timed out")
        }),
    ).pipe(
      Effect.retry(
        Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("30 seconds")]),
      ),
    )
  return Effect.all(
    Array.from({ length: options.count }, (_, index) => workerSlot(index + 1)),
    { concurrency: "unbounded" },
  )
}
