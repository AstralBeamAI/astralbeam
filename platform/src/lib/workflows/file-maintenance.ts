import { sql } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { fileObject } from "@/db/schema/files"
import purgeFile from "./purge-file"

// Schedule durable purges for files explicitly retired by their consumers.
// Rotating updated_at recovers missed submissions fairly across bounded batches.
const fileMaintenance = Effect.gen(function* () {
  const db = yield* Database
  const purging = yield* db
    .update(fileObject)
    .set({ updatedAt: sql`now()` })
    .where(sql`(${fileObject.organizationId}, ${fileObject.id}) in (
      select f.organization_id, f.id from file_object f
      where f.status = 'purging'
      order by f.updated_at, f.id limit 1000 for update skip locked
    )`)
    .returning({
      organizationId: fileObject.organizationId,
      fileId: fileObject.id,
      objectKey: fileObject.objectKey,
    })
    .pipe(mapDatabaseErrors())
  yield* Effect.forEach(purging, (file) => purgeFile.execute(file, { discard: true }), {
    concurrency: 4,
    discard: true,
  })
})

export default fileMaintenance
