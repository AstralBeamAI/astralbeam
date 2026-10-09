import { sql } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { fileUpload } from "@/db/schema/chat.server"
import {
  fileDeletion,
  multipartDeletion,
  organizationImageImport,
  userImageImport,
} from "@/db/schema/files.server"

export const reportStorageHealth = Effect.gen(function* () {
  const db = yield* Database
  const [counts] = yield* db
    .select({
      pendingImports: sql<number>`(count(*) filter (where ${userImageImport.status} = 'pending') + (select count(*) from ${organizationImageImport} where ${organizationImageImport.status} = 'pending'))::integer`,
      pendingUploads: sql<number>`(select count(*)::integer from ${fileUpload} where ${fileUpload.status} in ('preparing', 'pending', 'completing'))`,
      pendingDeletions: sql<number>`(select count(*)::integer from ${fileDeletion})`,
      pendingMultipartDeletions: sql<number>`(select count(*)::integer from ${multipartDeletion})`,
      retriedDeletions: sql<number>`((select count(*) from ${fileDeletion} where ${fileDeletion.attempts} > 0) + (select count(*) from ${multipartDeletion} where ${multipartDeletion.attempts} > 0))::integer`,
    })
    .from(userImageImport)
    .pipe(mapDatabaseErrors())
  yield* Effect.logInfo("File storage health", counts)
})
