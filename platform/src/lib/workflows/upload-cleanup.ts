import { and, eq, isNull } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Activity, DurableClock, Workflow } from "effect/workflow"
import { Database } from "@/db/database"
import { chatFile } from "@/db/schema/chat"
import { fileObject } from "@/db/schema/files"
import { fileUpload } from "@/db/schema/uploads"
import { UuidV7Schema } from "@/lib/schemas"
import { MultipartStorage } from "@/lib/storage/multipart-storage.server"
import { ObjectStorage } from "@/lib/storage/object-storage.server"

// The journal retains staging keys even when a Tenant or Organization cascades its upload rows.
const uploadCleanup = Workflow.make("UploadCleanup/v1", {
  payload: {
    organizationId: UuidV7Schema,
    tenantId: UuidV7Schema,
    uploadId: UuidV7Schema,
    objectKey: Schema.String,
    deadline: Schema.Number,
  },
  idempotencyKey: ({ objectKey, deadline }) => `${objectKey}:${deadline}`,
})

export const uploadCleanupWorkflowLayer = uploadCleanup.toLayer((payload) =>
  Effect.gen(function* () {
    const db = yield* Database
    const storage = yield* ObjectStorage
    const multipart = yield* MultipartStorage
    // Staging completion makes up to three bounded requests. Let cancelled producers settle first.
    yield* DurableClock.sleep({
      name: "Deadline",
      duration: Math.max(120_000, payload.deadline - Date.now()),
      inMemoryThreshold: 0,
    })
    for (let step = 0; ; step += 1) {
      const done = yield* Activity.make({
        name: `Cleanup-${step}`,
        success: Schema.Boolean,
        execute: Effect.gen(function* () {
          yield* db.transaction((tx) =>
            Effect.gen(function* () {
              const [row] = yield* tx
                .select()
                .from(fileUpload)
                .where(
                  and(
                    eq(fileUpload.organizationId, payload.organizationId),
                    eq(fileUpload.tenantId, payload.tenantId),
                    eq(fileUpload.id, payload.uploadId),
                    eq(fileUpload.objectKey, payload.objectKey),
                  ),
                )
              if (!row || row.status === "completed") return
              yield* tx
                .select()
                .from(fileObject)
                .where(
                  and(
                    eq(fileObject.organizationId, payload.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
                .for("update")
              // Completion and cancellation serialize on the final file, as message admission does.
              const [current] = yield* tx
                .select()
                .from(fileUpload)
                .where(
                  and(
                    eq(fileUpload.organizationId, payload.organizationId),
                    eq(fileUpload.tenantId, payload.tenantId),
                    eq(fileUpload.id, payload.uploadId),
                    eq(fileUpload.objectKey, payload.objectKey),
                  ),
                )
              if (!current || current.status === "completed") return
              yield* tx
                .delete(chatFile)
                .where(
                  and(
                    eq(chatFile.organizationId, payload.organizationId),
                    eq(chatFile.tenantId, payload.tenantId),
                    eq(chatFile.fileObjectId, row.fileId),
                    isNull(chatFile.messageId),
                  ),
                )
              yield* tx
                .update(fileObject)
                .set({ status: "purging" })
                .where(
                  and(
                    eq(fileObject.organizationId, payload.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
              yield* tx
                .update(fileUpload)
                .set({ status: "cancelled" })
                .where(
                  and(
                    eq(fileUpload.organizationId, payload.organizationId),
                    eq(fileUpload.tenantId, payload.tenantId),
                    eq(fileUpload.id, row.id),
                  ),
                )
            }),
          )
          const ids = yield* multipart.find(payload.objectKey)
          yield* Effect.forEach(ids, (id) => multipart.abort(payload.objectKey, id), {
            concurrency: 4,
            discard: true,
          })
          yield* storage.remove({ key: payload.objectKey })
          return true
        }).pipe(
          Effect.catch(() => Effect.as(Effect.logWarning("Upload cleanup will retry"), false)),
        ),
      })
      if (done) return
      yield* DurableClock.sleep({
        name: `Retry-${step}`,
        duration: "5 minutes",
        inMemoryThreshold: 0,
      })
    }
  }),
)

export default uploadCleanup
