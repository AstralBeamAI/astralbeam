import { createHash } from "node:crypto"
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { WorkflowEngine } from "effect/workflow"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { cacheEntry } from "@/db/schema/cache"
import { chatFile } from "@/db/schema/chat"
import { fileObject } from "@/db/schema/files"
import { fileUpload } from "@/db/schema/uploads"
import { tenantUser } from "@/db/schema/organizations"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { MultipartStorage, type StoragePart } from "@/lib/storage/multipart-storage.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import uploadCleanup from "@/lib/workflows/upload-cleanup"
import { ChatFileUnavailable } from "../threads/errors"
import type { ChatThreadScope } from "../threads/schemas"
import { normalizeChatAttachments } from "./attachments"
import { UPLOAD_PART_BYTES, type UploadStatus, type UploadInputSchema } from "./upload-schemas"
import {
  UploadNotFound,
  UploadConflict,
  UploadClaimed,
  UploadInvalid,
  UploadRateLimited,
} from "./errors"

type UploadFailure =
  | UploadNotFound
  | UploadConflict
  | UploadClaimed
  | UploadInvalid
  | UploadRateLimited
  | ChatFileUnavailable
type UploadRow = typeof fileUpload.$inferSelect
const uploadCancellationKey = (scope: ChatThreadScope, key: string) =>
  `${scope.organizationId}:${scope.tenantId}:${scope.tenantUserId}:${key}`
const uploadOwnerWhere = (scope: ChatThreadScope, id?: string) =>
  and(
    eq(fileUpload.organizationId, scope.organizationId),
    eq(fileUpload.tenantId, scope.tenantId),
    eq(fileUpload.tenantUserId, scope.tenantUserId),
    id ? eq(fileUpload.id, id) : undefined,
  )
const uploadResource = (
  row: UploadRow,
  parts: readonly StoragePart[] = [],
  claimed = false,
): UploadStatus => ({
  id: row.id,
  claimed,
  status:
    row.status !== "completed" && row.expiresAt.getTime() <= Date.now() ? "expired" : row.status,
  filename: row.filename,
  contentType: row.contentType,
  byteSize: row.byteSize,
  sha256: row.sha256,
  expiresAt: row.expiresAt.toISOString(),
  partSize: UPLOAD_PART_BYTES,
  parts: parts.map(({ number, size }) => ({ number, size })),
  fileId: row.status === "completed" ? row.fileId : null,
})

export class Uploads extends Context.Service<
  Uploads,
  {
    readonly prepare: (
      scope: ChatThreadScope,
      input: typeof UploadInputSchema.Type,
    ) => Effect.Effect<UploadStatus, UploadFailure, WorkflowEngine.WorkflowEngine>
    readonly status: (
      scope: ChatThreadScope,
      id: string,
    ) => Effect.Effect<UploadStatus, UploadFailure>
    readonly sign: (
      scope: ChatThreadScope,
      id: string,
      numbers: readonly number[],
    ) => Effect.Effect<{ parts: { number: number; url: string }[] }, UploadFailure>
    readonly complete: (
      scope: ChatThreadScope,
      id: string,
    ) => Effect.Effect<UploadStatus, UploadFailure, WorkflowEngine.WorkflowEngine>
    readonly cancel: (
      scope: ChatThreadScope,
      id: string,
    ) => Effect.Effect<void, UploadFailure, WorkflowEngine.WorkflowEngine>
    readonly cancelPrepared: (
      scope: ChatThreadScope,
      key: string,
    ) => Effect.Effect<void, UploadFailure, WorkflowEngine.WorkflowEngine>
  }
>()("astralbeam/chat/Uploads") {
  static readonly layerNoDeps = Layer.effect(
    Uploads,
    Effect.gen(function* () {
      const db = yield* Database
      const objects = yield* ObjectStorage
      const multipart = yield* MultipartStorage
      const stored = yield* StoredFiles
      const storage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.mapError(() => new ChatFileUnavailable()))
      const owned = Effect.fnUntraced(function* (scope: ChatThreadScope, id: string) {
        const [row] = yield* db
          .select()
          .from(fileUpload)
          .where(uploadOwnerWhere(scope, id))
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new UploadNotFound()
        return row
      })
      const lockUploader = Effect.fnUntraced(function* (scope: ChatThreadScope) {
        const [person] = yield* db
          .select({ id: tenantUser.id })
          .from(tenantUser)
          .where(
            and(
              eq(tenantUser.organizationId, scope.organizationId),
              eq(tenantUser.tenantId, scope.tenantId),
              eq(tenantUser.id, scope.tenantUserId),
            ),
          )
          .for("update")
        if (!person) return yield* new UploadNotFound()
      })
      const cleanup = (row: UploadRow, cancel = false) =>
        uploadCleanup.execute(
          {
            organizationId: row.organizationId,
            tenantId: row.tenantId,
            uploadId: row.id,
            objectKey: row.objectKey,
            deadline: cancel ? 0 : row.expiresAt.getTime(),
          },
          { discard: true },
        )
      const active = (row: UploadRow) =>
        row.expiresAt.getTime() > Date.now() && row.uploadId !== null
      const status = Effect.fn("Uploads.status")(function* (scope: ChatThreadScope, id: string) {
        const row = yield* owned(scope, id)
        const [claim] =
          row.status === "completed"
            ? yield* db
                .select({ messageId: chatFile.messageId })
                .from(chatFile)
                .where(
                  and(
                    eq(chatFile.organizationId, scope.organizationId),
                    eq(chatFile.tenantId, scope.tenantId),
                    eq(chatFile.fileObjectId, row.fileId),
                  ),
                )
                .pipe(mapDatabaseErrors())
            : []
        return uploadResource(
          row,
          active(row) && row.status === "pending"
            ? yield* storage(multipart.list(row.objectKey, row.uploadId!))
            : [],
          claim?.messageId != null,
        )
      })
      const prepare = Effect.fn("Uploads.prepare")(function* (
        scope: ChatThreadScope,
        input: typeof UploadInputSchema.Type,
      ) {
        const contentType = input.contentType.split(";")[0]!.trim().toLowerCase()
        if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) return yield* new UploadInvalid()
        const prepared = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockUploader(scope)
              const prepareKey = input.prepareKey ?? crypto.randomUUID()
              const [cancelled] = yield* tx
                .select({ id: cacheEntry.id })
                .from(cacheEntry)
                .where(
                  and(
                    eq(cacheEntry.namespace, "UploadCancellation/v1"),
                    eq(cacheEntry.key, uploadCancellationKey(scope, prepareKey)),
                    gt(cacheEntry.expiresAt, sql`now()`),
                  ),
                )
              if (cancelled) return yield* new UploadConflict()
              const [existing] = yield* tx
                .select()
                .from(fileUpload)
                .where(and(uploadOwnerWhere(scope), eq(fileUpload.prepareKey, prepareKey)))
              if (existing) {
                if (
                  existing.filename !== input.filename ||
                  existing.contentType !== contentType ||
                  existing.byteSize !== input.byteSize ||
                  existing.sha256 !== input.sha256
                )
                  return yield* new UploadConflict()
                if (
                  existing.status !== "preparing" ||
                  existing.expiresAt.getTime() <= Date.now() ||
                  existing.updatedAt.getTime() > Date.now() - 30_000
                )
                  return { row: existing, create: false }
                const [recovered] = yield* tx
                  .update(fileUpload)
                  .set({
                    objectKey: `upload-staging/${crypto.randomUUID()}`,
                    updatedAt: sql`now()`,
                  })
                  .where(uploadOwnerWhere(scope, existing.id))
                  .returning()
                yield* cleanup(existing, true)
                yield* cleanup(recovered!)
                return { row: recovered!, create: true }
              }
              const pending = yield* tx
                .select({ id: fileUpload.id })
                .from(fileUpload)
                .where(
                  and(
                    uploadOwnerWhere(scope),
                    gt(fileUpload.expiresAt, sql`now()`),
                    inArray(fileUpload.status, ["preparing", "pending", "completing"]),
                  ),
                )
                .limit(10)
              if (pending.length >= 10) return yield* new UploadRateLimited()
              const [file] = yield* tx
                .insert(fileObject)
                .values({
                  organizationId: scope.organizationId,
                  objectKey: `files/${scope.organizationId}/${crypto.randomUUID()}`,
                  contentType,
                  byteSize: input.byteSize,
                  sha256: input.sha256,
                })
                .returning()
              yield* tx.insert(chatFile).values({
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                uploaderTenantUserId: scope.tenantUserId,
                fileObjectId: file!.id,
              })
              const [row] = yield* tx
                .insert(fileUpload)
                .values({
                  ...scope,
                  prepareKey,
                  fileId: file!.id,
                  objectKey: `upload-staging/${crypto.randomUUID()}`,
                  filename: input.filename,
                  contentType,
                  byteSize: input.byteSize,
                  sha256: input.sha256,
                })
                .returning()
              yield* cleanup(row!)
              return { row: row!, create: true }
            }),
          )
          .pipe(mapDatabaseErrors())
        if (!prepared.create) return uploadResource(prepared.row)
        const row = prepared.row
        const uploadId = yield* storage(multipart.create(row.objectKey, row.contentType))
        const [pending] = yield* db
          .update(fileUpload)
          .set({ uploadId, status: "pending" })
          .where(
            and(
              uploadOwnerWhere(scope, row.id),
              eq(fileUpload.status, "preparing"),
              eq(fileUpload.objectKey, row.objectKey),
              gt(fileUpload.expiresAt, sql`now()`),
            ),
          )
          .returning()
          .pipe(mapDatabaseErrors())
        if (!pending) {
          yield* cleanup(row, true)
          return yield* new UploadConflict()
        }
        return uploadResource(pending)
      })
      const sign = Effect.fn("Uploads.sign")(function* (
        scope: ChatThreadScope,
        id: string,
        numbers: readonly number[],
      ) {
        const row = yield* owned(scope, id)
        if (!active(row) || row.status !== "pending") return yield* new UploadConflict()
        const count = Math.ceil(row.byteSize / UPLOAD_PART_BYTES)
        if (
          !numbers.length ||
          numbers.length > 4 ||
          new Set(numbers).size !== numbers.length ||
          numbers.some((n) => !Number.isInteger(n) || n < 1 || n > count)
        )
          return yield* new UploadInvalid()
        const parts = yield* Effect.forEach(numbers, (number) =>
          storage(
            multipart.sign(
              row.objectKey,
              row.uploadId!,
              number,
              Math.min(UPLOAD_PART_BYTES, row.byteSize - (number - 1) * UPLOAD_PART_BYTES),
            ),
          ).pipe(Effect.map((url) => ({ number, url }))),
        )
        return { parts }
      })
      const cancel = Effect.fn("Uploads.cancel")(function* (scope: ChatThreadScope, id: string) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockUploader(scope)
              const row = yield* owned(scope, id)
              yield* tx
                .select()
                .from(fileObject)
                .where(
                  and(
                    eq(fileObject.organizationId, scope.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
                .for("update")
              const [claimed] = yield* tx
                .select({ messageId: chatFile.messageId })
                .from(chatFile)
                .where(
                  and(
                    eq(chatFile.organizationId, scope.organizationId),
                    eq(chatFile.tenantId, scope.tenantId),
                    eq(chatFile.fileObjectId, row.fileId),
                  ),
                )
              if (claimed?.messageId) return yield* new UploadClaimed()
              yield* tx
                .update(fileUpload)
                .set({ status: "cancelled" })
                .where(uploadOwnerWhere(scope, id))
              yield* tx
                .delete(chatFile)
                .where(
                  and(
                    eq(chatFile.organizationId, scope.organizationId),
                    eq(chatFile.tenantId, scope.tenantId),
                    eq(chatFile.fileObjectId, row.fileId),
                    isNull(chatFile.messageId),
                  ),
                )
              yield* tx
                .update(fileObject)
                .set({ status: "purging" })
                .where(
                  and(
                    eq(fileObject.organizationId, scope.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
              yield* cleanup(row, true)
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const completeStaging = Effect.fnUntraced(function* (row: UploadRow) {
        const existing = yield* objects.head({ key: row.objectKey }).pipe(
          Effect.catchTag("StorageObjectMissing", () => Effect.succeed(null)),
          Effect.mapError(() => new ChatFileUnavailable()),
        )
        if (existing) return
        const parts = yield* storage(multipart.list(row.objectKey, row.uploadId!))
        const count = Math.ceil(row.byteSize / UPLOAD_PART_BYTES)
        if (
          parts.length !== count ||
          parts.some(
            (part, index) =>
              part.number !== index + 1 ||
              part.size !== Math.min(UPLOAD_PART_BYTES, row.byteSize - index * UPLOAD_PART_BYTES) ||
              !part.etag,
          )
        )
          return yield* new UploadInvalid()
        yield* multipart.complete(row.objectKey, row.uploadId!, parts).pipe(
          Effect.catchTag("MultipartMissing", () =>
            objects.head({ key: row.objectKey }).pipe(Effect.asVoid),
          ),
          Effect.mapError(() => new ChatFileUnavailable()),
        )
      })
      const complete = Effect.fn("Uploads.complete")(function* (
        scope: ChatThreadScope,
        id: string,
      ) {
        const row = yield* owned(scope, id)
        if (row.status === "completed") return uploadResource(row)
        if (!active(row) || !["pending", "completing"].includes(row.status))
          return yield* new UploadConflict()
        yield* db
          .update(fileUpload)
          .set({ status: "completing" })
          .where(
            and(uploadOwnerWhere(scope, id), inArray(fileUpload.status, ["pending", "completing"])),
          )
          .pipe(mapDatabaseErrors())
        yield* completeStaging(row).pipe(
          Effect.catchTag("UploadInvalid", (error) =>
            db
              .update(fileUpload)
              .set({ status: "pending" })
              .where(and(uploadOwnerWhere(scope, id), eq(fileUpload.status, "completing")))
              .pipe(mapDatabaseErrors(), Effect.andThen(Effect.fail(error))),
          ),
        )
        const bytes = yield* storage(objects.get({ key: row.objectKey, maxBytes: row.byteSize }))
        const part = {
          type: row.contentType.startsWith("image/") ? ("image" as const) : ("document" as const),
          source: {
            type: "data" as const,
            value: Buffer.from(bytes).toString("base64"),
            mimeType: row.contentType,
          },
          metadata: { filename: row.filename },
        }
        const valid = normalizeChatAttachments([{ role: "user", content: [part] }], {
          sandbox: true,
        })
        if (
          bytes.length !== row.byteSize ||
          createHash("sha256").update(bytes).digest("hex") !== row.sha256 ||
          valid.attachments.some((a) => a.result === "rejected")
        ) {
          yield* cancel(scope, id)
          return yield* new UploadInvalid()
        }
        const [file] = yield* db
          .select()
          .from(fileObject)
          .where(
            and(eq(fileObject.organizationId, scope.organizationId), eq(fileObject.id, row.fileId)),
          )
          .pipe(mapDatabaseErrors())
        if (!file || file.status === "purging") return yield* new UploadConflict()
        // Accepted keys never receive browser write grants. https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
        yield* storage(objects.put({ key: file.objectKey, bytes, contentType: row.contentType }))
        yield* storage(stored.read({ file }))
        return yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const [current] = yield* tx
                .select()
                .from(fileObject)
                .where(
                  and(
                    eq(fileObject.organizationId, scope.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
                .for("update")
              if (!current || current.status === "purging") return yield* new UploadConflict()
              const [finished] = yield* tx
                .update(fileUpload)
                .set({ status: "completed" })
                .where(
                  and(
                    uploadOwnerWhere(scope, id),
                    inArray(fileUpload.status, ["completing", "completed"]),
                    gt(fileUpload.expiresAt, sql`now()`),
                  ),
                )
                .returning()
              if (!finished) return yield* new UploadConflict()
              yield* tx
                .update(fileObject)
                .set({ status: "stored" })
                .where(
                  and(
                    eq(fileObject.organizationId, scope.organizationId),
                    eq(fileObject.id, row.fileId),
                  ),
                )
              yield* cleanup(row, true)
              return uploadResource(finished)
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const cancelPrepared = Effect.fn("Uploads.cancelPrepared")(function* (
        scope: ChatThreadScope,
        key: string,
      ) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockUploader(scope)
              yield* tx
                .insert(cacheEntry)
                .values({
                  namespace: "UploadCancellation/v1",
                  key: uploadCancellationKey(scope, key),
                  value: "true",
                  expiresAt: sql`now() + interval '24 hours'`,
                })
                .onConflictDoUpdate({
                  target: [cacheEntry.namespace, cacheEntry.key],
                  set: { expiresAt: sql`now() + interval '24 hours'` },
                })
              const [row] = yield* tx
                .select()
                .from(fileUpload)
                .where(and(uploadOwnerWhere(scope), eq(fileUpload.prepareKey, key)))
              if (row) yield* cancel(scope, row.id)
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      return Uploads.of({ prepare, status, sign, complete, cancel, cancelPrepared })
    }),
  )
  static readonly layer = Uploads.layerNoDeps.pipe(
    Layer.provide([Database.layer, ObjectStorage.layer, MultipartStorage.layer, StoredFiles.layer]),
  )
}
