import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import { StorageUnavailable } from "./errors"
import { ObjectStorage } from "./object-storage.server"

const fileSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

type StoredFile = typeof fileObject.$inferSelect
type FileUpload = { organizationId: string; bytes: Uint8Array; contentType: string }

export class StoredFiles extends Context.Service<StoredFiles>()("astralbeam/storage/StoredFiles", {
  make: Effect.gen(function* () {
    const db = yield* Database
    const storage = yield* ObjectStorage
    const read = Effect.fn("StoredFiles.read")(function* ({ file }: { file: StoredFile }) {
      const bytes = yield* storage.get({ key: file.objectKey, maxBytes: file.byteSize })
      if (bytes.length !== file.byteSize || fileSha256(bytes) !== file.sha256)
        return yield* new StorageUnavailable()
      return bytes
    })
    const upload = Effect.fn("StoredFiles.upload")(
      function* (input: FileUpload) {
        const file = yield* fileObject.insert({
          organizationId: input.organizationId,
          objectKey: `files/${input.organizationId}/${crypto.randomUUID()}`,
          contentType: input.contentType,
          byteSize: input.bytes.length,
          sha256: fileSha256(input.bytes),
        })
        yield* storage.put({ ...input, key: file.objectKey })
        yield* read({ file })
        yield* fileObject
          .update(file, { status: "stored" }, { where: eq(fileObject.status, "pending") })
          .pipe(Effect.catchTag("NotFound", () => new StorageUnavailable()))
        return { id: file.id }
      },
      Effect.provideService(Database, db),
      mapDatabaseErrors(),
    )
    return { upload, read }
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make)
  static readonly layer = StoredFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, ObjectStorage.layer]),
  )
}
