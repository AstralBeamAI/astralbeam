import { and, eq, inArray, like, sql as drizzleSql } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

import { Database } from "@/db/database.ts"
import { cacheEntry } from "@/db/schema/cache.ts"
import { fileObject } from "@/db/schema/files.ts"
import { tenant } from "@/db/schema/organizations.ts"

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
        .update(fileObject)
        .set({ status: "purging" })
        .where(
          drizzleSql`${fileObject.organizationId} = ${input.organizationId} and ${fileObject.id} in (select file_object_id from chat_file where organization_id = ${input.organizationId} and tenant_id = ${input.tenantId})`,
        )
      yield* db
        .delete(tenant)
        .where(and(eq(tenant.organizationId, input.organizationId), eq(tenant.id, input.tenantId)))
      yield* db
        .delete(cacheEntry)
        .where(
          and(
            inArray(cacheEntry.namespace, ["chat", "mcp-oauth"]),
            like(cacheEntry.key, `${input.organizationId}:${input.tenantId}:%`),
          ),
        )
    }),
  )
})
