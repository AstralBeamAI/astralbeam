import process from "node:process"

import { Deferred, Effect, type Fiber } from "effect"
import type { NitroAppPlugin } from "nitro/types"
import type { ViteHotContext } from "vite/types/hot.d.ts"

import { closeClusterProcess, startClusterRunner, stopClusterRunner } from "./runtime.ts"
import { serverLoggerLayer } from "../runtime/logging.server.ts"

// Nitro reloads can invalidate modules without HMR disposal. Keep listener cleanup process-wide.
// https://vite.dev/guide/api-environment-runtimes.html#modulerunner
const clusterShutdownCleanupKey = Symbol.for("platform.clusterShutdownCleanup")
const clusterPluginProcess = globalThis as typeof globalThis & {
  [clusterShutdownCleanupKey]?: () => void
}

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender || process.env.NODE_ENV === "test") return
  clusterPluginProcess[clusterShutdownCleanupKey]?.()
  // These lifecycle roots run outside the app runtime and need its logger explicitly.
  Effect.runFork(startClusterRunner.pipe(Effect.provide(serverLoggerLayer)))

  // Vite provides this context, while Bun declares its own incompatible hot-reload interface.
  const hot = import.meta.hot as unknown as ViteHotContext | undefined
  if (hot) {
    // Vite owns development signals and requests this cleanup before it terminates the worker.
    const closeDevelopmentCluster = () =>
      Effect.runFork(
        closeClusterProcess.pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Development cluster cleanup failed", cause),
          ),
          Effect.andThen(Effect.sync(() => hot.send("astralbeam:closed"))),
          Effect.provide(serverLoggerLayer),
        ),
      )
    const removeShutdownHandlers = () => {
      hot.off("astralbeam:close", closeDevelopmentCluster)
      if (clusterPluginProcess[clusterShutdownCleanupKey] === removeShutdownHandlers) {
        delete clusterPluginProcess[clusterShutdownCleanupKey]
      }
    }
    clusterPluginProcess[clusterShutdownCleanupKey] = removeShutdownHandlers
    hot.on("astralbeam:close", closeDevelopmentCluster)
    hot.dispose(() => {
      removeShutdownHandlers()
      Effect.runFork(stopClusterRunner.pipe(Effect.provide(serverLoggerLayer)))
    })
    return
  }

  // Let HTTP requests drain before closing resources, bounded by srvx's graceful timeout.
  // https://srvx.h3.dev/guide/lifecycle
  const drained = Deferred.makeUnsafe<void>()
  nitro.hooks.hook("close", () => void Deferred.doneUnsafe(drained, Effect.void))
  const shutdown = Deferred.await(drained).pipe(
    Effect.timeoutOption("5 seconds"),
    Effect.andThen(closeClusterProcess.pipe(Effect.timeout("5 seconds"))),
    Effect.matchCauseEffect({
      onSuccess: () => Effect.sync(() => process.exit(0)),
      onFailure: (cause) =>
        Effect.logError("Server shutdown cleanup failed or timed out", cause).pipe(
          Effect.andThen(Effect.sync(() => process.exit(1))),
        ),
    }),
    Effect.provide(serverLoggerLayer),
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
