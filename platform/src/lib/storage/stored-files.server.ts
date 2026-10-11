import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { StorageObjectMissing, StorageUnavailable } from "./errors"
import { ObjectStorage } from "./object-storage.server"

const fileSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

type StoredFile = typeof fileObject.$inferSelect
type FileUpload = { organizationId: string; bytes: Uint8Array; contentType: string }

export class StoredFiles extends Context.Service<
  StoredFiles,
  {
    readonly upload: (
      input: FileUpload,
    ) => Effect.Effect<{ readonly id: string }, StorageUnavailable | StorageObjectMissing>
  }
>()("astralbeam/storage/StoredFiles") {
  // Coordinates file metadata and verified S3 uploads, independently of consumers.
  // Callers supply dependencies here. The layer below wires the production services.
  static readonly layerNoDeps = Layer.effect(
    StoredFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* ObjectStorage
      const verifyStoredUpload = Effect.fn("verifyStoredUpload")(function* (file: StoredFile) {
        const bytes = yield* storage.get({ key: file.objectKey, maxBytes: file.byteSize })
        if (bytes.length !== file.byteSize || fileSha256(bytes) !== file.sha256)
          return yield* new StorageUnavailable()
      })
      const upload = Effect.fn("StoredFiles.upload")(function* (input: FileUpload) {
        const [file] = yield* db
          .insert(fileObject)
          .values({
            organizationId: input.organizationId,
            objectKey: `files/${input.organizationId}/${crypto.randomUUID()}`,
            contentType: input.contentType,
            byteSize: input.bytes.length,
            sha256: fileSha256(input.bytes),
          })
          .returning()
          .pipe(mapDatabaseErrors())
        yield* storage.put({ ...input, key: file!.objectKey })
        yield* verifyStoredUpload(file!)
        const [verified] = yield* db
          .update(fileObject)
          .set({ status: "stored" })
          .where(
            and(
              eq(fileObject.organizationId, input.organizationId),
              eq(fileObject.id, file!.id),
              eq(fileObject.status, "pending"),
            ),
          )
          .returning({ id: fileObject.id })
          .pipe(mapDatabaseErrors())
        if (!verified) return yield* new StorageUnavailable()
        return verified
      })
      return StoredFiles.of({ upload })
    }),
  )
  static readonly layer = StoredFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, ObjectStorage.layer]),
  )
}
