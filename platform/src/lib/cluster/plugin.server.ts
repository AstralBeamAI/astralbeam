import process from "node:process"

import { Deferred, Effect, type Fiber } from "effect"
import type { NitroAppPlugin } from "nitro/types"

import { closeClusterProcess, startClusterRunner, stopClusterRunner } from "./runtime.server.ts"

// Nitro reloads can invalidate modules without HMR disposal. Keep listener cleanup process-wide.
// https://vite.dev/guide/api-environment-runtimes.html#modulerunner
const clusterShutdownCleanupKey = Symbol.for("platform.clusterShutdownCleanup")
const clusterPluginProcess = globalThis as typeof globalThis & {
  [clusterShutdownCleanupKey]?: () => void
}

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender || process.env.NODE_ENV === "test") return
  clusterPluginProcess[clusterShutdownCleanupKey]?.()
  Effect.runFork(startClusterRunner)

  if (import.meta.hot) {
    // Vite owns development signals and requests this cleanup before it terminates the worker.
    const closeDevelopmentCluster = () =>
      Effect.runFork(
        closeClusterProcess.pipe(
          Effect.catchCause(() => Effect.logError("Development cluster cleanup failed")),
          Effect.andThen(Effect.sync(() => import.meta.hot?.send("astralbeam:closed"))),
        ),
      )
    const removeShutdownHandlers = () => {
      import.meta.hot?.off("astralbeam:close", closeDevelopmentCluster)
      if (clusterPluginProcess[clusterShutdownCleanupKey] === removeShutdownHandlers) {
        delete clusterPluginProcess[clusterShutdownCleanupKey]
      }
    }
    clusterPluginProcess[clusterShutdownCleanupKey] = removeShutdownHandlers
    import.meta.hot.on("astralbeam:close", closeDevelopmentCluster)
    import.meta.hot.dispose(() => {
      removeShutdownHandlers()
      Effect.runFork(stopClusterRunner)
    })
    return
  }

  // Deno's server shutdown waits for open streams such as chat runs, so cleanup waits for Nitro's
  // close hook only as long as srvx's own graceful timeout. https://docs.deno.com/api/deno/~/Deno.HttpServer
  const drained = Deferred.makeUnsafe<void>()
  nitro.hooks.hook("close", () => void Deferred.doneUnsafe(drained, Effect.void))
  const shutdown = Deferred.await(drained).pipe(
    Effect.timeoutOption("5 seconds"),
    Effect.andThen(closeClusterProcess.pipe(Effect.timeout("5 seconds"))),
    Effect.matchCauseEffect({
      onSuccess: () => Effect.sync(() => process.exit(0)),
      onFailure: () =>
        Effect.logError("Server shutdown cleanup failed or timed out").pipe(
          Effect.andThen(Effect.sync(() => process.exit(1))),
        ),
    }),
  )
  let shutdownFiber: Fiber.Fiber<never> | undefined
  const startShutdown = () => {
    shutdownFiber ??= Effect.runFork(shutdown)
  }
  process.on("SIGTERM", startShutdown)
  process.on("SIGINT", startShutdown)
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default clusterPlugin
