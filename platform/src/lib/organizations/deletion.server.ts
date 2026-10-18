import { and, eq, inArray, like } from "drizzle-orm"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

import { Database } from "@/db/database.ts"
import { user } from "@/db/schema/authentication.ts"
import { cacheEntry } from "@/db/schema/cache.ts"
import { apiKey, invitation, member, organization } from "@/db/schema/organizations.ts"
import { fileObject } from "@/db/schema/files.ts"
import { ObjectStorage } from "../storage/object-storage.server.ts"
import { filePreviewObjectKey } from "../storage/file-previews.server.ts"
import { deleteTenant } from "../tenants/deletion.ts"

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
      yield* db
        .delete(cacheEntry)
        .where(
          and(
            inArray(cacheEntry.namespace, ["chat", "mcp-oauth"]),
            like(cacheEntry.key, `${organizationId}:%`),
          ),
        )
      return yield* db.delete(organization).where(eq(organization.id, organizationId))
    }),
  )
})

// Delete objects before the Organization cascade removes their metadata. Workflow retries retain progress.
export const deleteOrganizationFileBatch = Effect.fn("deleteOrganizationFileBatch")(function* (
  organizationId: string,
) {
  const db = yield* Database
  const storage = yield* ObjectStorage
  yield* db
    .update(organization)
    .set({ logo: null, logoFileId: null })
    .where(eq(organization.id, organizationId))
  const batch = yield* db
    .select()
    .from(fileObject)
    .where(eq(fileObject.organizationId, organizationId))
    .orderBy(fileObject.id)
    .limit(1000)
  yield* Effect.forEach(
    batch,
    (file) =>
      Effect.gen(function* () {
        yield* storage.remove({ key: file.objectKey })
        yield* storage.remove({ key: filePreviewObjectKey(file.objectKey) })
        yield* db
          .delete(fileObject)
          .where(and(eq(fileObject.organizationId, organizationId), eq(fileObject.id, file.id)))
      }),
    { concurrency: 4, discard: true },
  )
  return batch.length
})
