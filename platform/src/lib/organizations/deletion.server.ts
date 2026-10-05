import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The cluster runner loads this module through Nitro, which cannot resolve the `@/` alias.
import { Database } from "../../db/database.server.ts"
import { user } from "../../db/schema/authentication.server.ts"
import { apiKey, invitation, member, organization } from "../../db/schema/organizations.server.ts"
import { deleteTenantRow } from "../tenants/deletion.server.ts"

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

export const deleteOrganizationTenantBatch = Effect.fn("deleteOrganizationTenantBatch")(function* (
  organizationId: string,
) {
  const sql = yield* SqlClient.SqlClient
  const tenants = yield* sql<{ id: string }>`select id from tenant
    where organization_id = ${organizationId} limit 1000`
  yield* Effect.forEach(tenants, ({ id }) => deleteTenantRow({ organizationId, tenantId: id }), {
    discard: true,
  })
  return tenants.length
})

/** Cascades to the organization's remaining agents, sandbox providers, and configuration. */
export const deleteOrganizationRow = Effect.fn("deleteOrganizationRow")(function* (
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
