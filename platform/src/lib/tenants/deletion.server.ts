import { and, eq, inArray, like } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The cluster runner loads this module through Nitro, which cannot resolve the `@/` alias.
import { Database } from "../../db/database.server.ts"
import { cacheEntry } from "../../db/schema/cache.server.ts"
import { tenant } from "../../db/schema/organizations.server.ts"

/** Cascades to the Tenant's users and chat rows in one transaction. */
export const deleteTenant = Effect.fn("deleteTenant")(function* (input: {
  organizationId: string
  tenantId: string
}) {
  const sql = yield* SqlClient.SqlClient
  const db = yield* Database
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET CONSTRAINTS ALL DEFERRED`
      yield* db
        .delete(tenant)
        .where(and(eq(tenant.organizationId, input.organizationId), eq(tenant.id, input.tenantId)))
      yield* db
        .delete(cacheEntry)
        .where(
          and(
            inArray(cacheEntry.namespace, ["chat", "UploadCancellation/v1"]),
            like(cacheEntry.key, `${input.organizationId}:${input.tenantId}:%`),
          ),
        )
    }),
  )
})
