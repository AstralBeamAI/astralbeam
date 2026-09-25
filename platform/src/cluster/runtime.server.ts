import { Cause, Context, Duration, Effect, Fiber, Layer, Schedule } from "effect"
import { Sharding, ShardingConfig } from "effect/unstable/cluster"

import { sqlState } from "../db/lib/sqlstate.server.ts"
import { getDatabaseResources, effectDatabaseLayer } from "../db/index.ts"
import { registeredWorkflowLayers } from "../workflows/registry.server.ts"
import { clusterRunnerLayer, clusterRunnerSettings } from "./runner.server.ts"

const clusterRuntimeKey = Symbol.for("platform.clusterRuntime")
const clusterProcess = globalThis as typeof globalThis & {
  [clusterRuntimeKey]?: {
    transition: Promise<void>
    fiber?: Fiber.Fiber<unknown, unknown> | undefined
    unavailable?: string | undefined
  }
}
const clusterRuntimeState = (clusterProcess[clusterRuntimeKey] ??= {
  transition: Promise.resolve(),
})

const superviseClusterRunner = Effect.gen(function* () {
  const engine = clusterRunnerLayer(clusterRunnerSettings())
  const context = yield* Layer.build(
    registeredWorkflowLayers.pipe(Layer.provideMerge(engine), Layer.provide(effectDatabaseLayer)),
  )
  const sharding = Context.get(context, Sharding.Sharding)
  const config = Context.get(context, ShardingConfig.ShardingConfig)
  clusterRuntimeState.unavailable = undefined
  yield* Effect.logInfo("Cluster runner ready", { address: config.runnerAddress })
  yield* Effect.gen(function* () {
    if (yield* sharding.isShutdown) return yield* Effect.fail(new Error("Cluster runner stopped"))
  }).pipe(Effect.repeat(Schedule.spaced("5 seconds")))
}).pipe(
  Effect.scoped,
  Effect.catchCause((cause) => {
    if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
    const code = sqlState(cause)
    const sqlstate = code && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined
    const reason = sqlstate ?? "unknown"
    if (clusterRuntimeState.unavailable === reason) return Effect.void
    clusterRuntimeState.unavailable = reason
    return Effect.logWarning(
      "Cluster runner unavailable. Check database connectivity, runner address and cluster storage privileges.",
      { sqlstate },
    )
  }),
  Effect.repeat(
    Schedule.exponential("1 second").pipe(
      Schedule.modifyDelay(({ duration }) =>
        Effect.succeed(Duration.min(duration, Duration.seconds(30))),
      ),
    ),
  ),
)

export function startClusterRunner(): Promise<void> {
  clusterRuntimeState.transition = stopClusterRunner().then(() => {
    try {
      clusterRuntimeState.fiber = getDatabaseResources().runtime.runFork(superviseClusterRunner)
    } catch {
      console.error("Cluster runner could not start. Check server configuration.")
    }
  })
  return clusterRuntimeState.transition
}

export function stopClusterRunner(): Promise<void> {
  clusterRuntimeState.transition = clusterRuntimeState.transition.then(async () => {
    if (clusterRuntimeState.fiber)
      await getDatabaseResources().runtime.runPromise(Fiber.interrupt(clusterRuntimeState.fiber))
    clusterRuntimeState.fiber = undefined
  })
  return clusterRuntimeState.transition
}
