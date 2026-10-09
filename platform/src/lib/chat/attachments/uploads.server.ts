import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { DatabaseRateLimiter, hashedRateLimitKey } from "@/db/lib/rate-limiter.server"
import {
  cacheEntry,
  chatFile,
  fileObject,
  fileUpload,
  multipartDeletion,
  tenantUser,
} from "@/db/schema.server"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { MultipartStorage, type StoragePart } from "@/lib/storage/multipart-storage.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import { fileSha256 } from "@/lib/storage/images"
import { ChatThreadStorageUnavailable } from "../threads/errors"
import type { ChatThreadScope } from "../threads/schemas"
import { normalizeChatAttachments, normalizeMimeType } from "./attachments.server"
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
  | ChatThreadStorageUnavailable
type UploadRow = typeof fileUpload.$inferSelect
const uploadCancellationKey = (scope: ChatThreadScope, prepareKey: string) =>
  `${scope.organizationId}:${scope.tenantId}:${scope.tenantUserId}:${prepareKey}`
const uploadOwnerWhere = (scope: ChatThreadScope, id?: string) =>
  and(
    eq(fileUpload.organizationId, scope.organizationId),
    eq(fileUpload.tenantId, scope.tenantId),
    eq(fileUpload.tenantUserId, scope.tenantUserId),
    id ? eq(fileUpload.id, id) : undefined,
  )
function uploadResource(row: UploadRow, parts: readonly StoragePart[] = []): UploadStatus {
  return {
    id: row.id,
    status: row.expiresAt.getTime() <= Date.now() ? "expired" : row.status,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    expiresAt: row.expiresAt.toISOString(),
    partSize: UPLOAD_PART_BYTES,
    parts: parts.map(({ number, size }) => ({ number, size })),
    fileId: row.fileId,
  }
}

export class Uploads extends Context.Service<
  Uploads,
  {
    readonly prepare: (
      scope: ChatThreadScope,
      input: typeof UploadInputSchema.Type,
    ) => Effect.Effect<UploadStatus, UploadFailure>
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
    ) => Effect.Effect<UploadStatus, UploadFailure>
    readonly cancel: (scope: ChatThreadScope, id: string) => Effect.Effect<void, UploadFailure>
    readonly cancelPrepared: (
      scope: ChatThreadScope,
      prepareKey: string,
    ) => Effect.Effect<void, UploadFailure>
    readonly maintenance: Effect.Effect<void>
  }
>()("astralbeam/chat/Uploads") {
  static readonly layerNoDeps = Layer.effect(
    Uploads,
    Effect.gen(function* () {
      const db = yield* Database
      const objects = yield* ObjectStorage
      const multipart = yield* MultipartStorage
      const stored = yield* StoredFiles
      const limiter = yield* DatabaseRateLimiter
      const safeStorage = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.mapError(() => new ChatThreadStorageUnavailable()))
      const owned = Effect.fnUntraced(function* (scope: ChatThreadScope, id: string) {
        const [row] = yield* db
          .select()
          .from(fileUpload)
          .where(uploadOwnerWhere(scope, id))
          .pipe(mapDatabaseErrors())
        if (!row) return yield* new UploadNotFound()
        return row
      })
      const active = (row: UploadRow) =>
        row.expiresAt.getTime() > Date.now() && row.uploadId !== null
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
      const status = Effect.fn("Uploads.status")(function* (scope: ChatThreadScope, id: string) {
        const row = yield* owned(scope, id)
        const parts =
          active(row) && row.status === "pending"
            ? yield* safeStorage(multipart.list(row.objectKey, row.uploadId!))
            : []
        return uploadResource(row, parts)
      })
      const prepare = Effect.fn("Uploads.prepare")(function* (
        scope: ChatThreadScope,
        input: typeof UploadInputSchema.Type,
      ) {
        const contentType = normalizeMimeType(input.contentType)
        if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType) || contentType.length > 255)
          return yield* new UploadInvalid()
        const prepared = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockUploader(scope)
              if (input.prepareKey) {
                const [existing] = yield* tx
                  .select()
                  .from(fileUpload)
                  .where(and(uploadOwnerWhere(scope), eq(fileUpload.prepareKey, input.prepareKey)))
                if (existing) {
                  if (
                    existing.filename !== input.filename ||
                    existing.contentType !== contentType ||
                    existing.byteSize !== input.byteSize ||
                    existing.sha256 !== input.sha256
                  )
                    return yield* new UploadConflict()
                  if (existing.status === "preparing") {
                    const [claimed] = yield* tx
                      .update(fileUpload)
                      .set({
                        objectKey: `upload-staging/${crypto.randomUUID()}`,
                        updatedAt: sql`now()`,
                      })
                      .where(
                        and(
                          uploadOwnerWhere(scope, existing.id),
                          eq(fileUpload.status, "preparing"),
                          eq(fileUpload.objectKey, existing.objectKey),
                          // Multipart creation is bounded to 30 seconds. A new key fences late creators.
                          lte(fileUpload.updatedAt, sql`now() - interval '30 seconds'`),
                          gt(fileUpload.expiresAt, sql`now()`),
                        ),
                      )
                      .returning()
                    if (claimed) {
                      yield* tx
                        .insert(multipartDeletion)
                        .values({ objectKey: existing.objectKey })
                        .onConflictDoNothing()
                      return { row: claimed, created: true }
                    }
                  }
                  return { row: existing, created: false }
                }
                const [cancelled] = yield* tx
                  .select({ id: cacheEntry.id })
                  .from(cacheEntry)
                  .where(
                    and(
                      eq(cacheEntry.namespace, "UploadCancellation/v1"),
                      eq(cacheEntry.key, uploadCancellationKey(scope, input.prepareKey)),
                      gt(cacheEntry.expiresAt, sql`statement_timestamp()`),
                    ),
                  )
                if (cancelled) return yield* new UploadConflict()
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
              yield* limiter
                .consume({
                  key: hashedRateLimitKey("file-upload", [
                    scope.organizationId,
                    scope.tenantId,
                    scope.tenantUserId,
                  ]),
                  limit: 60,
                  window: "1 hour",
                })
                .pipe(
                  Effect.mapError((error) =>
                    error.reason._tag === "RateLimitExceeded"
                      ? new UploadRateLimited()
                      : new ChatThreadStorageUnavailable(),
                  ),
                )
              const [created] = yield* tx
                .insert(fileUpload)
                .values({
                  ...scope,
                  prepareKey: input.prepareKey,
                  filename: input.filename,
                  contentType,
                  byteSize: input.byteSize,
                  sha256: input.sha256,
                  objectKey: `upload-staging/${crypto.randomUUID()}`,
                })
                .returning()
              return { row: created!, created: true }
            }),
          )
          .pipe(mapDatabaseErrors())
        const { row } = prepared
        if (!prepared.created) return uploadResource(row)
        let uploadId: string | undefined
        return yield* Effect.gen(function* () {
          uploadId = yield* safeStorage(multipart.create(row.objectKey, row.contentType))
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
          if (!pending) return yield* new UploadConflict()
          return uploadResource(pending)
        }).pipe(
          Effect.onError(() =>
            Effect.gen(function* () {
              yield* db
                .delete(fileUpload)
                .where(
                  and(
                    uploadOwnerWhere(scope, row.id),
                    eq(fileUpload.status, "preparing"),
                    eq(fileUpload.objectKey, row.objectKey),
                  ),
                )
                .pipe(mapDatabaseErrors())
              // A fresh deletion ID prevents an older cleanup from acknowledging a late creation.
              yield* db
                .execute(sql`
                insert into ${multipartDeletion} (object_key, upload_id)
                select ${row.objectKey}, ${uploadId ?? null} where not exists (
                  select 1 from ${fileUpload} where ${fileUpload.objectKey} = ${row.objectKey}
                    and ${fileUpload.status} in ('preparing', 'pending', 'completing')
                    and ${fileUpload.expiresAt} > now()
                ) on conflict (object_key) do update set
                  id = uuidv7(), upload_id = null, updated_at = now(),
                  retry_at = least(${multipartDeletion.retryAt}, now() + interval '1 minute')
              `)
                .pipe(mapDatabaseErrors())
            }),
          ),
        )
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
          numbers.some((number) => !Number.isInteger(number) || number < 1 || number > count)
        )
          return yield* new UploadInvalid()
        const parts = yield* Effect.forEach(numbers, (number) =>
          safeStorage(
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
      const completeStaging = Effect.fnUntraced(function* (row: UploadRow) {
        const existing = yield* objects.head({ key: row.objectKey }).pipe(
          Effect.catchTag("StorageObjectMissing", () => Effect.succeed(null)),
          Effect.mapError(() => new ChatThreadStorageUnavailable()),
        )
        if (existing) return
        const parts = yield* multipart.list(row.objectKey, row.uploadId!).pipe(
          Effect.catchTag("MultipartMissing", () =>
            objects.head({ key: row.objectKey }).pipe(Effect.as(null)),
          ),
          Effect.mapError(() => new ChatThreadStorageUnavailable()),
        )
        if (!parts) return
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
          Effect.mapError(() => new ChatThreadStorageUnavailable()),
        )
      })
      const complete = Effect.fn("Uploads.complete")(function* (
        scope: ChatThreadScope,
        id: string,
      ) {
        let row = yield* owned(scope, id)
        if (row.status === "completed" && row.fileId) return uploadResource(row)
        if (!active(row) || !["pending", "completing"].includes(row.status))
          return yield* new UploadConflict()
        if (row.status === "pending") {
          const [claimed] = yield* db
            .update(fileUpload)
            .set({ status: "completing" })
            .where(
              and(
                uploadOwnerWhere(scope, id),
                eq(fileUpload.status, "pending"),
                gt(fileUpload.expiresAt, sql`now()`),
              ),
            )
            .returning()
            .pipe(mapDatabaseErrors())
          row = claimed ?? (yield* owned(scope, id))
          if (row.status !== "completing") return yield* new UploadConflict()
        }
        yield* completeStaging(row).pipe(
          Effect.catchTag("UploadInvalid", (error) =>
            db
              .update(fileUpload)
              .set({ status: "pending" })
              .where(and(uploadOwnerWhere(scope, id), eq(fileUpload.status, "completing")))
              .pipe(mapDatabaseErrors(), Effect.andThen(Effect.fail(error))),
          ),
        )
        const bytes = yield* safeStorage(
          objects.get({ key: row.objectKey, maxBytes: row.byteSize }),
        )
        if (bytes.length !== row.byteSize || (yield* fileSha256(bytes)) !== row.sha256) {
          yield* cancel(scope, id)
          return yield* new UploadInvalid()
        }
        const part = {
          type: row.contentType.startsWith("image/") ? ("image" as const) : ("document" as const),
          source: {
            type: "data" as const,
            value: Buffer.from(bytes).toString("base64"),
            mimeType: row.contentType,
          },
          metadata: { filename: row.filename },
        }
        const validated = normalizeChatAttachments([{ role: "user", content: [part] }], {
          sandbox: true,
        })
        if (validated.attachments.some((attachment) => attachment.result === "rejected")) {
          yield* cancel(scope, id)
          return yield* new UploadInvalid()
        }
        // Signed part URLs can be reused. Final objects always have a different server-only key.
        // https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
        const file = yield* safeStorage(
          stored.prepare({
            bytes,
            contentType: row.contentType,
            sourceIdentity: `upload:${row.organizationId}:${row.tenantId}:${row.id}`,
          }),
        )
        const [finished] = yield* db
          .update(fileUpload)
          .set({ status: "completed", fileId: file.id })
          .where(
            and(
              uploadOwnerWhere(scope, id),
              eq(fileUpload.status, "completing"),
              gt(fileUpload.expiresAt, sql`now()`),
            ),
          )
          .returning()
          .pipe(mapDatabaseErrors())
        if (!finished) {
          const current = yield* owned(scope, id)
          if (current.status === "completed" && current.fileId === file.id)
            return uploadResource(current)
          return yield* new UploadConflict()
        }
        yield* db
          .insert(multipartDeletion)
          .values({ objectKey: row.objectKey, uploadId: row.uploadId! })
          .onConflictDoNothing()
          .pipe(mapDatabaseErrors())
        yield* Effect.logInfo("File upload completed", {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          uploadId: id,
          byteSize: row.byteSize,
        })
        return uploadResource(finished)
      })
      const cancel = Effect.fn("Uploads.cancel")(function* (scope: ChatThreadScope, id: string) {
        const row = yield* owned(scope, id)
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              if (row.fileId) {
                yield* tx
                  .select()
                  .from(fileObject)
                  .where(eq(fileObject.id, row.fileId))
                  .for("update")
                const [claimed] = yield* tx
                  .select({ id: chatFile.id })
                  .from(chatFile)
                  .where(eq(chatFile.id, row.fileId))
                if (claimed) return yield* new UploadClaimed()
              }
              const [cancelled] = yield* tx
                .update(fileUpload)
                .set({ status: "cancelled" })
                .where(
                  and(
                    uploadOwnerWhere(scope, id),
                    row.fileId ? eq(fileUpload.fileId, row.fileId) : isNull(fileUpload.fileId),
                  ),
                )
                .returning()
              if (!cancelled) return yield* new UploadConflict()
              if (row.fileId) yield* tx.delete(fileObject).where(eq(fileObject.id, row.fileId))
              yield* tx
                .insert(multipartDeletion)
                .values({ objectKey: row.objectKey, uploadId: row.uploadId })
                .onConflictDoNothing()
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const cancelPrepared = Effect.fn("Uploads.cancelPrepared")(function* (
        scope: ChatThreadScope,
        prepareKey: string,
      ) {
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* lockUploader(scope)
              const [row] = yield* tx
                .select({ id: fileUpload.id })
                .from(fileUpload)
                .where(and(uploadOwnerWhere(scope), eq(fileUpload.prepareKey, prepareKey)))
              if (row) yield* cancel(scope, row.id)
              else
                yield* tx
                  .insert(cacheEntry)
                  .values({
                    namespace: "UploadCancellation/v1",
                    key: uploadCancellationKey(scope, prepareKey),
                    value: "true",
                    expiresAt: sql`statement_timestamp() + interval '24 hours'`,
                  })
                  .onConflictDoUpdate({
                    target: [cacheEntry.namespace, cacheEntry.key],
                    set: { expiresAt: sql`statement_timestamp() + interval '24 hours'` },
                  })
            }),
          )
          .pipe(mapDatabaseErrors())
      })
      const maintenance = Effect.gen(function* () {
        yield* db
          .execute(
            sql`with expired as materialized (select organization_id, tenant_id, id from file_upload where expires_at <= now() order by expires_at, id limit 1000 for update skip locked) delete from file_upload using expired where (file_upload.organization_id, file_upload.tenant_id, file_upload.id) = (expired.organization_id, expired.tenant_id, expired.id)`,
          )
          .pipe(mapDatabaseErrors())
        const pending = yield* db
          .select()
          .from(multipartDeletion)
          .where(lte(multipartDeletion.retryAt, sql`now()`))
          .orderBy(multipartDeletion.retryAt)
          .limit(100)
          .pipe(mapDatabaseErrors())
        for (const row of pending)
          yield* Effect.gen(function* () {
            const ids = row.uploadId ? [row.uploadId] : yield* multipart.find(row.objectKey)
            for (const id of ids) yield* multipart.abort(row.objectKey, id)
            yield* objects.remove({ key: row.objectKey })
            yield* db.delete(multipartDeletion).where(eq(multipartDeletion.id, row.id))
          }).pipe(
            Effect.catch(() =>
              db
                .update(multipartDeletion)
                .set({
                  attempts: sql`${multipartDeletion.attempts} + 1`,
                  retryAt: sql`now() + interval '5 minutes'`,
                })
                .where(eq(multipartDeletion.id, row.id))
                .pipe(
                  Effect.andThen(Effect.logWarning("Multipart cleanup will retry")),
                  Effect.asVoid,
                ),
            ),
          )
        if (pending.length)
          yield* Effect.logInfo("Multipart cleanup processed", { count: pending.length })
      }).pipe(Effect.catch(() => Effect.logWarning("Upload maintenance will retry")))
      return Uploads.of({ prepare, status, sign, complete, cancel, cancelPrepared, maintenance })
    }),
  )
  static readonly layer = Uploads.layerNoDeps.pipe(
    Layer.provide([
      Database.layer,
      ObjectStorage.layer,
      MultipartStorage.layer,
      StoredFiles.layer,
      DatabaseRateLimiter.layer,
    ]),
  )
}
