import { Effect, Predicate, Schema } from "effect"
import { Activity, DurableClock, Workflow } from "effect/workflow"

import { ProfileFiles } from "@/lib/storage/profile-files.server"
import { UuidV7Schema } from "@/lib/schemas"

// Retries one Gravatar or logo import, keeping retry state in the workflow journal.
const profileImageImport = Workflow.make("ProfileImageImport/v1", {
  payload: {
    image: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("avatar"),
        userId: UuidV7Schema,
        emailHash: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("logo"),
        ownerId: UuidV7Schema,
        generation: Schema.String,
      }),
    ]),
  },
  idempotencyKey: ({ image: input }) =>
    input.kind === "avatar"
      ? `avatar:${input.userId}:${input.emailHash}`
      : `logo:${input.ownerId}:${input.generation}`,
})

export const profileImageImportWorkflowLayer = profileImageImport.toLayer(({ image: payload }) =>
  Effect.gen(function* () {
    const files = yield* ProfileFiles
    let attempts = 0
    for (let step = 0; ; step += 1) {
      const result = yield* Activity.make({
        name: `ImportImage-${step}`,
        success: Schema.Literals(["done", "retry", "storage"]),
        execute: files
          .importImage({ ...payload, attempts })
          .pipe(
            Effect.catchDefect((error) =>
              Predicate.isTagged(error, "SqlError") ||
              Predicate.isTagged(error, "EffectDrizzleQueryError")
                ? Effect.as(
                    Effect.logWarning("Profile image import database operation failed"),
                    "storage" as const,
                  )
                : Effect.die(error),
            ),
          ),
      })
      if (result === "done") return
      yield* DurableClock.sleep({
        name: `RetryImage-${step}`,
        duration: `${result === "storage" ? 5 : 5 * 2 ** attempts} minutes`,
        inMemoryThreshold: 0,
      })
      if (result === "retry") attempts += 1
    }
  }),
)

export default profileImageImport
