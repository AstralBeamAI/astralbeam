import process from "node:process"

import type { NitroAppPlugin } from "nitro/types"

import { closeDatabase } from "../db/index.ts"
import { startClusterRunner, stopClusterRunner } from "./runtime.server.ts"

// Nitro reloads can invalidate modules without HMR disposal. Keep signal cleanup process-wide.
// https://vite.dev/guide/api-environment-runtimes.html#modulerunner
const clusterShutdownCleanupKey = Symbol.for("webapp.clusterShutdownCleanup")
const clusterPluginProcess = globalThis as typeof globalThis & {
  [clusterShutdownCleanupKey]?: () => void
}

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender || process.env.NODE_ENV === "test") return
  clusterPluginProcess[clusterShutdownCleanupKey]?.()
  void startClusterRunner()
  let shutdownDeadline: ReturnType<typeof setTimeout> | undefined
  const boundShutdown = () => {
    if (shutdownDeadline !== undefined) return
    shutdownDeadline = setTimeout(() => {
      console.error("Server shutdown exceeded the 5-second deadline")
      process.exit(1)
    }, 5_000)
  }
  const removeShutdownHandlers = () => {
    import.meta.hot?.off("astralbeam:close", closeDevelopmentCluster)
    clearTimeout(shutdownDeadline)
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
  const closeCluster = async () => {
    try {
      await stopClusterRunner()
      await closeDatabase()
      removeShutdownHandlers()
    } catch {
      console.error("Server shutdown cleanup failed")
      process.exit(1)
    }
  }
  nitro.hooks.hook("close", closeCluster)
  function closeDevelopmentCluster() {
    boundShutdown()
    void closeCluster().then(() => import.meta.hot?.send("astralbeam:closed"))
  }
  import.meta.hot?.on("astralbeam:close", closeDevelopmentCluster)
  import.meta.hot?.dispose(() => {
    removeShutdownHandlers()
    void stopClusterRunner()
  })
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default clusterPlugin
