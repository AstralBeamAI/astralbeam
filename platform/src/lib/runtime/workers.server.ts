import { spawn } from "node:child_process"
import { availableParallelism } from "node:os"
import process from "node:process"

import { Deferred, Effect, Result, Schedule, Schema } from "effect"

const workerCountSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
)

/** @knipignore Nitro loads this server entry from vite.config.ts. */
export default {
  reusePort: process.platform === "linux" && process.env.ASTRALBEAM_WORKER !== undefined,
}

export function resolvePlatformWorkerCount(): number {
  const value = process.env.WORKERS ?? "auto"
  if (value === "auto") return process.platform === "linux" ? availableParallelism() : 1
  const count = Schema.decodeUnknownResult(workerCountSchema)(value)
  if (Result.isFailure(count)) throw new Error("WORKERS must be auto or a positive integer")
  if (process.platform !== "linux" && count.success > 1) {
    throw new Error("Multiple HTTP workers require Linux. Use WORKERS=1 on macOS and Windows")
  }
  return count.success
}

function launchPlatformWorker(command: readonly string[], worker: number) {
  const child = spawn(command[0]!, command.slice(1), {
    env: { ...process.env, WORKERS: "1", ASTRALBEAM_WORKER: String(worker) },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  })
  const exited = new Promise<number>((resolve) => {
    child.on("error", () => {
      if (child.pid === undefined) resolve(1)
    })
    child.once("exit", (code) => resolve(code ?? 1))
  })
  console.error(`Started worker ${worker} (PID ${child.pid ?? "unavailable"})`)
  return { child, exited: Effect.promise(() => exited) }
}

/** Each slot owns its child's lifetime, including interruption while waiting to restart. */
export function supervisePlatformWorkers(options: {
  readonly count: number
  readonly command: readonly string[]
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const stopped = yield* Deferred.make<void>()
      let shutdownFailed = false
      const stop = () => void Deferred.doneUnsafe(stopped, Effect.void)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.on("SIGINT", stop)
          process.on("SIGTERM", stop)
        }),
        () =>
          Effect.sync(() => {
            process.off("SIGINT", stop)
            process.off("SIGTERM", stop)
          }),
      )
      const workerSlot = (worker: number) =>
        Effect.acquireUseRelease(
          Effect.sync(() => launchPlatformWorker(options.command, worker)),
          ({ exited }) =>
            Effect.gen(function* () {
              const code = yield* exited
              console.error(`Worker ${worker} exited (${code}), restarting with backoff`)
              return yield* Effect.fail(new Error("Worker exited"))
            }),
          ({ child, exited }) =>
            Effect.gen(function* () {
              if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
                return
              child.kill("SIGTERM")
              const result = yield* exited.pipe(Effect.timeoutOption("12 seconds"))
              if (result._tag === "None") {
                child.kill("SIGKILL")
                yield* exited
              }
              // Shutdown can reach a newly spawned worker before it installs signal handlers.
              shutdownFailed ||=
                result._tag === "None" || (result.value !== 0 && child.signalCode !== "SIGTERM")
            }),
        ).pipe(
          Effect.retry(
            Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("30 seconds")]),
          ),
        )
      yield* Effect.raceFirst(
        Effect.all(
          Array.from({ length: options.count }, (_, index) => workerSlot(index + 1)),
          {
            concurrency: "unbounded",
          },
        ),
        Deferred.await(stopped),
      )
      return shutdownFailed ? 1 : 0
    }),
  )
}
