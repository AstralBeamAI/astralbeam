import { Cause, Context, Duration, Effect, Fiber, Layer, Schedule, Semaphore } from "effect"
import { Sharding, ShardingConfig } from "effect/cluster"
import { WorkflowEngine } from "effect/workflow"

import { sqlState } from "../../db/lib/sqlstate.ts"
import { closeDatabase } from "../../db/database.ts"
import { disposeAppRuntimes, getAppRuntime } from "../runtime/runtime.server.ts"
import { registeredWorkflowLayers } from "../workflows/registry.ts"
import { ClusterUnavailableError } from "./errors.ts"
import { clusterRunnerLayer, clusterRunnerSettings } from "./runner.ts"

// Nitro reloads can invalidate modules without HMR disposal, so the lifecycle stays process-wide.
// https://vite.dev/guide/api-environment-runtimes.html#modulerunner
const clusterRuntimeKey = Symbol.for("platform.clusterRuntime")
const clusterProcess = globalThis as typeof globalThis & {
  [clusterRuntimeKey]?: {
    readonly transitions: Semaphore.Semaphore
    fiber?: Fiber.Fiber<unknown, unknown> | undefined
    unavailable?: string | undefined
    workflowEngine?: WorkflowEngine.WorkflowEngine["Service"] | undefined
  }
}
const clusterRuntimeState = (clusterProcess[clusterRuntimeKey] ??= {
  transitions: Semaphore.makeUnsafe(1),
})

const superviseClusterRunner = Effect.fnUntraced(function* (
  settings: Effect.Success<typeof clusterRunnerSettings>,
) {
  const context = yield* Layer.build(
    registeredWorkflowLayers.pipe(Layer.provideMerge(clusterRunnerLayer(settings))),
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
}, Effect.scoped)

const retryClusterRunner = <A, E, R>(supervise: Effect.Effect<A, E, R>) =>
  supervise.pipe(
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

const interruptClusterRunner = Effect.suspend(() => {
  const fiber = clusterRuntimeState.fiber
  clusterRuntimeState.fiber = undefined
  return fiber ? Fiber.interrupt(fiber) : Effect.void
})

/** Replaces any running supervisor with one on the app runtime's services. */
export const startClusterRunner = Effect.gen(function* () {
  yield* interruptClusterRunner
  const services = yield* getAppRuntime().contextEffect
  const settings = yield* clusterRunnerSettings
  clusterRuntimeState.fiber = yield* retryClusterRunner(superviseClusterRunner(settings)).pipe(
    Effect.provideContext(services),
    Effect.forkDetach,
  )
}).pipe(
  Effect.catchCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.logError("Cluster runner could not start. Check server configuration."),
  ),
  Semaphore.withPermit(clusterRuntimeState.transitions),
)

export const stopClusterRunner = Semaphore.withPermit(
  clusterRuntimeState.transitions,
  interruptClusterRunner,
)

/** Stops the runner before the app services it borrows, and those before the pools they use. */
export const closeClusterProcess = Effect.gen(function* () {
  yield* stopClusterRunner
  yield* Effect.promise(() => disposeAppRuntimes())
  yield* Effect.promise(() => closeDatabase())
})
