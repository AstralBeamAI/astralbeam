import { and, eq } from "drizzle-orm"
import { Effect, Predicate, Schema } from "effect"
import { Activity, DurableClock, Workflow } from "effect/workflow"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { UuidV7Schema } from "@/lib/schemas"

// One durable purge per file. Its payload retains the object key across retries and restarts.
const purgeFile = Workflow.make("PurgeFile/v1", {
  payload: { fileId: UuidV7Schema, objectKey: Schema.String },
  idempotencyKey: ({ fileId }) => fileId,
})

// Removes S3 content before deleting metadata, with durable waits between failed attempts.
export const purgeFileWorkflowLayer = purgeFile.toLayer((payload) =>
  Effect.gen(function* () {
    const db = yield* Database
    const storage = yield* ObjectStorage
    const purging = and(eq(fileObject.id, payload.fileId), eq(fileObject.status, "purging"))
    for (let step = 0; ; step += 1) {
      yield* DurableClock.sleep({
        name: `Wait-${step}`,
        duration: step === 0 ? "1 minute" : "5 minutes",
        inMemoryThreshold: 0,
      })
      const done = yield* Activity.make({
        name: `Purge-${step}`,
        success: Schema.Boolean,
        execute: Effect.gen(function* () {
          yield* storage.remove({ key: payload.objectKey })
          yield* db.delete(fileObject).where(purging).pipe(mapDatabaseErrors())
          return true
        }).pipe(
          Effect.catch(() => Effect.as(Effect.logWarning("Stored file purge will retry"), false)),
          Effect.catchDefect((error) =>
            Predicate.isTagged(error, "SqlError") ||
            Predicate.isTagged(error, "EffectDrizzleQueryError")
              ? Effect.as(Effect.logWarning("Stored file purge database operation failed"), false)
              : Effect.die(error),
          ),
        ),
      })
      if (done) return
    }
  }),
)

export default purgeFile
