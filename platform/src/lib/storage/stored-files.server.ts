import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { WorkflowEngine } from "effect/workflow"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import purgeFile from "@/lib/workflows/purge-file"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import { ObjectStorage } from "./object-storage.server"

const fileSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

type StoredFile = typeof fileObject.$inferSelect
type FileUpload = { bytes: Uint8Array; contentType: string }

export class StoredFiles extends Context.Service<
  StoredFiles,
  {
    readonly upload: (
      input: FileUpload,
    ) => Effect.Effect<{ readonly id: string }, StorageUnavailable | StorageObjectMissing>
    readonly read: (
      file: StoredFile,
    ) => Effect.Effect<Uint8Array, StorageUnavailable | StorageObjectMissing>
    readonly cleanup: Effect.Effect<void, never, WorkflowEngine.WorkflowEngine>
  }
>()("astralbeam/storage/StoredFiles") {
  // Coordinates file metadata, verified S3 uploads and reads, and abandoned-upload cleanup.
  // Callers supply dependencies here. The layer below wires the production services.
  static readonly layerNoDeps = Layer.effect(
    StoredFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* ObjectStorage
      const read = Effect.fn("StoredFiles.read")(function* (file: StoredFile) {
        const bytes = yield* storage.get({ key: file.objectKey, maxBytes: file.byteSize })
        if (bytes.length !== file.byteSize || fileSha256(bytes) !== file.sha256)
          return yield* new StorageUnavailable()
        return bytes
      })
      const upload = Effect.fn("StoredFiles.upload")(function* (input: FileUpload) {
        const [file] = yield* db
          .insert(fileObject)
          .values({
            objectKey: `files/${crypto.randomUUID()}`,
            contentType: input.contentType,
            byteSize: input.bytes.length,
            sha256: fileSha256(input.bytes),
          })
          .returning()
          .pipe(mapDatabaseErrors())
        yield* storage.put({ ...input, key: file!.objectKey })
        yield* read(file!)
        const [verified] = yield* db
          .update(fileObject)
          .set({ status: "stored" })
          .where(and(eq(fileObject.id, file!.id), eq(fileObject.status, "pending")))
          .returning({ id: fileObject.id })
          .pipe(mapDatabaseErrors())
        if (!verified) return yield* new StorageUnavailable()
        return verified
      })
      const cleanup = Effect.gen(function* () {
        // Reserve a bounded batch before enqueueing. Rotating updated_at recovers missed submissions fairly.
        // Current avatar and logo references retain their files regardless of age.
        const purging = yield* db
          .update(fileObject)
          .set({ status: "purging", userId: null, organizationId: null, updatedAt: sql`now()` })
          .where(sql`${fileObject.id} in (
            select f.id from file_object f
            where (f.status = 'purging' or f.created_at <= now() - interval '24 hours')
              and not exists (select 1 from "user" where id = f.user_id and avatar_file_id = f.id)
              and not exists (select 1 from organization where id = f.organization_id and logo_file_id = f.id)
            order by f.updated_at, f.id limit 1000 for update skip locked
          )`)
          .returning({ fileId: fileObject.id, objectKey: fileObject.objectKey })
          .pipe(mapDatabaseErrors())
        yield* Effect.forEach(purging, (file) => purgeFile.execute(file, { discard: true }), {
          concurrency: 4,
          discard: true,
        })
      })
      return StoredFiles.of({ upload, read, cleanup })
    }),
  )
  static readonly layer = StoredFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, ObjectStorage.layer]),
  )
}
