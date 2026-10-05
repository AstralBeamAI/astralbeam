import { and, eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The cluster runner loads this module through Nitro, which cannot resolve the `@/` alias.
import { Database } from "../../db/database.server.ts"
import { cacheEntry } from "../../db/schema/cache.server.ts"
import { user } from "../../db/schema/authentication.server.ts"
import { chatThread } from "../../db/schema/chat.server.ts"
import { apiKey, invitation, member, organization } from "../../db/schema/organizations.server.ts"
import { deleteTenant } from "../tenants/deletion.server.ts"

/** Ends dashboard, REST, and SDK access at once and returns the owners' user IDs to notify. */
export const revokeOrganizationAccess = Effect.fn("revokeOrganizationAccess")(function* (
  organizationId: string,
) {
  const db = yield* Database
  yield* db.delete(invitation).where(eq(invitation.organizationId, organizationId))
  yield* db.delete(apiKey).where(eq(apiKey.organizationId, organizationId))
  const members = yield* db
    .delete(member)
    .where(eq(member.organizationId, organizationId))
    .returning({ userId: member.userId, role: member.role })
  return [
    ...new Set(
      members.filter(({ role }) => role.split(",").includes("owner")).map((row) => row.userId),
    ),
  ]
})

export function readUserEmails(userIds: readonly string[]) {
  return Effect.flatMap(Database, (db) =>
    db
      .select({ email: user.email })
      .from(user)
      .where(inArray(user.id, [...userIds])),
  ).pipe(Effect.map((rows) => rows.map((row) => row.email)))
}

export const deleteOrganizationThreadBatch = Effect.fn("deleteOrganizationThreadBatch")(function* (
  organizationId: string,
) {
  const db = yield* Database
  return yield* db.transaction((transaction) =>
    Effect.gen(function* () {
      const rows = yield* transaction
        .select({ id: chatThread.id })
        .from(chatThread)
        .where(eq(chatThread.organizationId, organizationId))
        .limit(100)
        .for("update")
      if (rows.length === 0) return 0
      const ids = rows.map((row) => row.id)
      yield* transaction.delete(cacheEntry).where(
        inArray(
          cacheEntry.namespace,
          ids.map((id) => `chat:${id}`),
        ),
      )
      yield* transaction
        .update(chatThread)
        .set({
          currentLeafMessageId: null,
        })
        .where(and(eq(chatThread.organizationId, organizationId), inArray(chatThread.id, ids)))
      yield* transaction
        .delete(chatThread)
        .where(and(eq(chatThread.organizationId, organizationId), inArray(chatThread.id, ids)))
      return rows.length
    }),
  )
})

export const deleteOrganizationTenantBatch = Effect.fn("deleteOrganizationTenantBatch")(function* (
  organizationId: string,
) {
  const sql = yield* SqlClient.SqlClient
  const tenants = yield* sql<{ id: string }>`select id from tenant
    where organization_id = ${organizationId} order by id limit 1000`
  yield* Effect.forEach(tenants, ({ id }) => deleteTenant({ organizationId, tenantId: id }), {
    discard: true,
  })
  return tenants.length
})

/** Cascades to the organization's remaining agents, sandbox providers, and configuration. */
export const deleteOrganization = Effect.fn("deleteOrganization")(function* (
  organizationId: string,
) {
  const sql = yield* SqlClient.SqlClient
  const db = yield* Database
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SET CONSTRAINTS ALL DEFERRED`
      return yield* db.delete(organization).where(eq(organization.id, organizationId))
    }),
  )
})
