import { Cause, Context, Data, Duration, Effect, Fiber, Layer, Schedule } from "effect"
import { Sharding, ShardingConfig } from "effect/unstable/cluster"
import { WorkflowEngine } from "effect/unstable/workflow"

import { sqlState } from "../../db/lib/sqlstate.server.ts"
import { Database, getDatabaseResources } from "../../db/index.ts"
import { Mailer } from "../email/email.server.ts"
import { registeredWorkflowLayers } from "../workflows/registry.server.ts"
import { clusterRunnerLayer, clusterRunnerSettings } from "./runner.server.ts"

const clusterRuntimeKey = Symbol.for("platform.clusterRuntime")
const clusterProcess = globalThis as typeof globalThis & {
  [clusterRuntimeKey]?: {
    transition: Promise<void>
    fiber?: Fiber.Fiber<unknown, unknown> | undefined
    unavailable?: string | undefined
    workflowEngine?: WorkflowEngine.WorkflowEngine["Service"] | undefined
  }
}
const clusterRuntimeState = (clusterProcess[clusterRuntimeKey] ??= {
  transition: Promise.resolve(),
})

const superviseClusterRunner = Effect.gen(function* () {
  const engine = clusterRunnerLayer(clusterRunnerSettings())
  const context = yield* Layer.build(
    registeredWorkflowLayers.pipe(
      Layer.provideMerge(engine),
      Layer.provide([Database.layerNoDeps, Mailer.layer]),
    ),
  )
  const sharding = Context.get(context, Sharding.Sharding)
  const config = Context.get(context, ShardingConfig.ShardingConfig)
  clusterRuntimeState.unavailable = undefined
  clusterRuntimeState.workflowEngine = Context.get(context, WorkflowEngine.WorkflowEngine)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      clusterRuntimeState.workflowEngine = undefined
    }),
  )
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

export class ClusterUnavailableError extends Data.TaggedError("ClusterUnavailableError") {}

/** Submits workflows through this process's running engine, so no request builds a runner. */
export function provideClusterWorkflowEngine<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.suspend<A, E | ClusterUnavailableError, Exclude<R, WorkflowEngine.WorkflowEngine>>(
    () => {
      const engine = clusterRuntimeState.workflowEngine
      return engine
        ? Effect.provideService(effect, WorkflowEngine.WorkflowEngine, engine)
        : Effect.fail(new ClusterUnavailableError())
    },
  )
}

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
