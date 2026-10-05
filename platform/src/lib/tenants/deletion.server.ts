import { and, eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The cluster runner loads this module through Nitro, which cannot resolve the `@/` alias.
import { Database } from "../../db/database.server.ts"
import { cacheEntry } from "../../db/schema/cache.server.ts"
import { chatThread } from "../../db/schema/chat.server.ts"
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
      // Prevent new threads while deletion collects their cache namespaces.
      yield* db
        .select({ id: tenant.id })
        .from(tenant)
        .where(and(eq(tenant.organizationId, input.organizationId), eq(tenant.id, input.tenantId)))
        .for("update")
      const threads = yield* db
        .select({ id: chatThread.id })
        .from(chatThread)
        .where(
          and(
            eq(chatThread.organizationId, input.organizationId),
            eq(chatThread.tenantId, input.tenantId),
          ),
        )
      yield* db
        .delete(tenant)
        .where(and(eq(tenant.organizationId, input.organizationId), eq(tenant.id, input.tenantId)))
      yield* db.delete(cacheEntry).where(
        inArray(
          cacheEntry.namespace,
          threads.map(({ id }) => `chat:${id}`),
        ),
      )
    }),
  )
})
