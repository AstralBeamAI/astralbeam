import { Effect, Schema } from "effect"
import { Activity, DurableClock, Workflow } from "effect/unstable/workflow"

export const exampleWorkflow = Workflow.make("system.example/v1", {
  payload: {
    key: Schema.String,
    runAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
  },
  success: Schema.String,
  idempotencyKey: ({ key }) => key,
})

export const exampleWorkflowLayer = exampleWorkflow.toLayer(({ key, runAt }) =>
  Effect.gen(function* () {
    if (runAt !== undefined) {
      yield* DurableClock.sleep({
        name: "scheduled-start",
        duration: Math.max(
          0,
          runAt - (yield* Effect.clockWith((clock) => clock.currentTimeMillis)),
        ),
        inMemoryThreshold: 0,
      })
    }
    return yield* Activity.make({
      name: "execute",
      success: Schema.String,
      execute: Effect.succeed(`Completed ${key}`),
    })
  }),
)
