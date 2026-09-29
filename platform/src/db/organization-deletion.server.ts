import { eq, inArray } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"

// The cluster runner loads this module through Nitro, which cannot resolve the `@/` alias.
import { effectDatabase } from "./index.ts"
import { user } from "./schema/authentication.server.ts"
import { apiKey, invitation, member, organization } from "./schema/organizations.server.ts"

/** Ends dashboard, REST, and SDK access at once and returns the owners' user IDs to notify. */
export function revokeOrganizationAccess(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
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
}

export function readUserEmails(userIds: readonly string[]) {
  return Effect.flatMap(effectDatabase, (db) =>
    db
      .select({ email: user.email })
      .from(user)
      .where(inArray(user.id, [...userIds])),
  ).pipe(Effect.map((rows) => rows.map((row) => row.email)))
}

export function deleteOrganizationTenantUserBatch(organizationId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const deleted = yield* sql<{ id: string }>`delete from tenant_user
      where organization_id = ${organizationId} and (tenant_id, id) in (
        select tenant_id, id from tenant_user where organization_id = ${organizationId} limit 1000
      ) returning id`
    return deleted.length
  })
}

export function deleteOrganizationTenantBatch(organizationId: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const deleted = yield* sql<{ id: string }>`delete from tenant
      where organization_id = ${organizationId} and id in (
        select id from tenant where organization_id = ${organizationId} limit 1000
      ) returning id`
    return deleted.length
  })
}

/** Cascades to the organization's remaining agents, sandbox providers, and configuration. */
export function deleteOrganizationRow(organizationId: string) {
  return Effect.flatMap(effectDatabase, (db) =>
    db.delete(organization).where(eq(organization.id, organizationId)),
  )
}
