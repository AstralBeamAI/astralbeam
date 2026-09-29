import process from "node:process"

import { Effect, Fiber } from "effect"
import type { NitroAppPlugin } from "nitro/types"

import { closeClusterProcess, startClusterRunner, stopClusterRunner } from "./runtime.server.ts"

// Nitro reloads can invalidate modules without HMR disposal. Keep signal cleanup process-wide.
// https://vite.dev/guide/api-environment-runtimes.html#modulerunner
const clusterShutdownCleanupKey = Symbol.for("platform.clusterShutdownCleanup")
const clusterPluginProcess = globalThis as typeof globalThis & {
  [clusterShutdownCleanupKey]?: () => void
}

const exitProcess = (message: string) =>
  Effect.logError(message).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender || process.env.NODE_ENV === "test") return
  clusterPluginProcess[clusterShutdownCleanupKey]?.()
  Effect.runFork(startClusterRunner)
  let shutdownDeadline: Fiber.Fiber<void> | undefined
  const boundShutdown = () => {
    shutdownDeadline ??= Effect.runFork(
      exitProcess("Server shutdown exceeded the 5-second deadline").pipe(Effect.delay("5 seconds")),
    )
  }
  const removeShutdownHandlers = () => {
    import.meta.hot?.off("astralbeam:close", closeDevelopmentCluster)
    if (shutdownDeadline) Effect.runFork(Fiber.interrupt(shutdownDeadline))
    process.off("SIGTERM", boundShutdown)
    process.off("SIGINT", boundShutdown)
    if (clusterPluginProcess[clusterShutdownCleanupKey] === removeShutdownHandlers) {
      delete clusterPluginProcess[clusterShutdownCleanupKey]
    }
  }
  clusterPluginProcess[clusterShutdownCleanupKey] = removeShutdownHandlers
  process.on("SIGTERM", boundShutdown)
  process.on("SIGINT", boundShutdown)

  // Nitro awaits HTTP draining before runtime close hooks in the Deno preset.
  // https://github.com/nitrojs/nitro/pull/4574
  const closeCluster = closeClusterProcess.pipe(
    Effect.andThen(Effect.sync(removeShutdownHandlers)),
    Effect.catchCause(() => exitProcess("Server shutdown cleanup failed")),
  )
  nitro.hooks.hook("close", () => Effect.runPromise(closeCluster))
  function closeDevelopmentCluster() {
    boundShutdown()
    Effect.runFork(
      closeCluster.pipe(
        Effect.andThen(Effect.sync(() => import.meta.hot?.send("astralbeam:closed"))),
      ),
    )
  }
  import.meta.hot?.on("astralbeam:close", closeDevelopmentCluster)
  import.meta.hot?.dispose(() => {
    removeShutdownHandlers()
    Effect.runFork(stopClusterRunner)
  })
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default clusterPlugin
