import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { fileDeletion, fileObject } from "@/db/schema/files.server"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import { fileSha256 } from "./images"
import { ObjectStorage } from "./object-storage.server"

export type StoredFile = typeof fileObject.$inferSelect

export class StoredFiles extends Context.Service<
  StoredFiles,
  {
    readonly prepare: (input: {
      bytes: Uint8Array
      contentType: string
      sourceIdentity?: string
    }) => Effect.Effect<StoredFile, StorageUnavailable | StorageObjectMissing>
    readonly resume: (
      sourceIdentity: string,
    ) => Effect.Effect<StoredFile | null, StorageUnavailable | StorageObjectMissing>
    readonly read: (
      file: StoredFile,
    ) => Effect.Effect<Uint8Array, StorageUnavailable | StorageObjectMissing>
    readonly cleanup: Effect.Effect<void>
  }
>()("astralbeam/storage/StoredFiles") {
  static readonly layerNoDeps = Layer.effect(
    StoredFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* ObjectStorage
      const read = Effect.fn("StoredFiles.read")(function* (file: StoredFile) {
        const bytes = yield* storage.get({ key: file.objectKey, maxBytes: file.byteSize })
        if (bytes.length !== file.byteSize || (yield* fileSha256(bytes)) !== file.sha256)
          return yield* new StorageUnavailable()
        return bytes
      })
      const verifyPrepared = Effect.fn("StoredFiles.verifyPrepared")(function* (file: StoredFile) {
        yield* read(file)
        const [verified] = yield* db
          .update(fileObject)
          .set({ verifiedAt: sql`now()` })
          .where(
            and(
              eq(fileObject.id, file.id),
              or(isNull(fileObject.expiresAt), gt(fileObject.expiresAt, sql`now()`)),
            ),
          )
          .returning()
          .pipe(mapDatabaseErrors())
        if (!verified) {
          yield* db
            .insert(fileDeletion)
            .values({ objectKey: file.objectKey })
            .onConflictDoNothing()
            .pipe(mapDatabaseErrors())
          return yield* new StorageUnavailable()
        }
        return verified
      })
      const prepare = Effect.fn("StoredFiles.prepare")(function* (input: {
        bytes: Uint8Array
        contentType: string
        sourceIdentity?: string
      }) {
        const sha256 = yield* fileSha256(input.bytes)
        const [file] = yield* db
          .insert(fileObject)
          .values({
            objectKey: `files/${crypto.randomUUID()}`,
            contentType: input.contentType,
            byteSize: input.bytes.length,
            sha256,
            sourceIdentity: input.sourceIdentity,
          })
          .onConflictDoUpdate({
            target: fileObject.sourceIdentity,
            set: {
              expiresAt: sql`case when ${fileObject.expiresAt} is null then null else now() + interval '24 hours' end`,
            },
          })
          .returning()
          .pipe(mapDatabaseErrors())
        if (
          !file ||
          file.sha256 !== sha256 ||
          file.byteSize !== input.bytes.length ||
          file.contentType !== input.contentType
        )
          return yield* new StorageUnavailable()
        const upload = storage.put({
          key: file.objectKey,
          bytes: input.bytes,
          contentType: input.contentType,
        })
        if (!file.verifiedAt) yield* upload
        return yield* verifyPrepared(file).pipe(
          Effect.catchTag("StorageObjectMissing", () =>
            upload.pipe(Effect.andThen(verifyPrepared(file))),
          ),
        )
      })
      const resume = Effect.fn("StoredFiles.resume")(function* (sourceIdentity: string) {
        const [file] = yield* db
          .update(fileObject)
          .set({
            expiresAt: sql`case when ${fileObject.expiresAt} is null then null else now() + interval '24 hours' end`,
          })
          .where(eq(fileObject.sourceIdentity, sourceIdentity))
          .returning()
          .pipe(mapDatabaseErrors())
        if (!file) return null
        return yield* verifyPrepared(file).pipe(
          Effect.catchTag("StorageObjectMissing", () => Effect.succeed(null)),
        )
      })
      const cleanup = Effect.gen(function* () {
        yield* db
          .execute(sql`
          with expired as materialized (
            select id from file_object where expires_at <= now()
            order by expires_at, id limit 1000 for update skip locked
          )
          delete from file_object using expired where file_object.id = expired.id
        `)
          .pipe(mapDatabaseErrors())
        const pending = yield* db
          .select()
          .from(fileDeletion)
          .where(lte(fileDeletion.retryAt, sql`now()`))
          .orderBy(fileDeletion.retryAt)
          .limit(100)
          .pipe(mapDatabaseErrors())
        for (const target of pending) {
          yield* storage.remove({ key: target.objectKey }).pipe(
            Effect.andThen(
              db
                .delete(fileDeletion)
                .where(eq(fileDeletion.id, target.id))
                .pipe(mapDatabaseErrors()),
            ),
            Effect.catch(() =>
              Effect.gen(function* () {
                yield* db
                  .update(fileDeletion)
                  .set({
                    attempts: sql`${fileDeletion.attempts} + 1`,
                    retryAt: sql`now() + interval '5 minutes'`,
                  })
                  .where(eq(fileDeletion.id, target.id))
                  .pipe(mapDatabaseErrors())
                yield* Effect.logWarning("Stored file deletion will retry")
              }),
            ),
          )
        }
        if (pending.length)
          yield* Effect.logInfo("Stored file cleanup processed", { count: pending.length })
      })
      return StoredFiles.of({ prepare, resume, read, cleanup })
    }),
  )
  static readonly layer = StoredFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, ObjectStorage.layer]),
  )
}
