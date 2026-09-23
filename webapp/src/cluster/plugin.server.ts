import process from "node:process"
import { Effect, Fiber, Layer, Schedule } from "effect"
import type { NitroAppPlugin } from "nitro/types"
import { closeProcessDatabaseServices, databaseRuntime } from "@/db"
import { readClusterConfiguration } from "./config.server.ts"
import { workflowHandlersLayer } from "../workflows/registry.server.ts"
import { clusterRunnerLayer } from "./runtime.server.ts"

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (process.env.CLUSTER_ENABLED === "false" || process.env.NODE_ENV === "test") return
  let configuration: ReturnType<typeof readClusterConfiguration>
  try {
    configuration = readClusterConfiguration(process.env)
  } catch (error) {
    console.error(
      "Cluster disabled:",
      error instanceof Error ? error.message : "Invalid configuration",
    )
    return
  }
  const supervisor = databaseRuntime.runFork(
    Layer.launch(
      workflowHandlersLayer.pipe(Layer.provideMerge(clusterRunnerLayer(configuration))),
    ).pipe(
      Effect.catchCause(() =>
        Effect.logError(
          "Cluster unavailable. Check database migrations and runner networking. Retrying in 10 seconds.",
        ),
      ),
      Effect.repeat(Schedule.spaced("10 seconds")),
    ),
  )
  let stopPromise: Promise<void> | undefined
  let httpDrained: Promise<void> = Promise.resolve()
  nitro.hooks.hook("request", ({ req }) => {
    const request = req as Request & {
      runtime?: { deno?: { server?: { finished: Promise<void> } } }
    }
    httpDrained = request.runtime?.deno?.server?.finished ?? httpDrained
  })
  const stopCluster = () => {
    stopPromise ??= Effect.runPromise(Fiber.interrupt(supervisor)).then(() => undefined)
    return stopPromise
  }
  // Nitro's Deno preset does not call the close hook for process signals.
  // https://github.com/nitrojs/nitro/tree/main/src/presets/deno
  const stopClusterOnSignal = () => {
    // srvx owns the HTTP signal handler; Deno's finished waits for response streams too.
    void Promise.all([stopCluster(), httpDrained])
      .then(closeProcessDatabaseServices)
      .catch(() => {
        console.error("Cluster shutdown did not complete cleanly")
      })
  }
  process.once("SIGTERM", stopClusterOnSignal)
  process.once("SIGINT", stopClusterOnSignal)
  nitro.hooks.hook("close", async () => {
    process.off("SIGTERM", stopClusterOnSignal)
    process.off("SIGINT", stopClusterOnSignal)
    await stopCluster()
  })
}

export default clusterPlugin
