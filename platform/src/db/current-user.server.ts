import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { effectDatabase } from "@/db"
import { tenant, tenantUser } from "@/db/schema/organizations.server"
import type { ChatPrincipal } from "@/lib/chat/types"
import { tenantDatabaseError } from "./tenant.server"

export function syncTenantCurrentUser(principal: ChatPrincipal) {
  return Effect.gen(function* () {
    const database = yield* effectDatabase
    const identity = principal.tenantUser
    const organizationId = principal.organization.id
    return yield* database.transaction((tx) =>
      Effect.gen(function* () {
        const [customer] = yield* tx
          .insert(tenant)
          .values({
            organizationId,
            externalId: identity.tenant.id,
            name: identity.tenant.name,
            metadata: identity.tenant.metadata,
          })
          .onConflictDoUpdate({
            target: [tenant.organizationId, tenant.externalId],
            set: {
              name: identity.tenant.name,
              metadata: identity.tenant.metadata,
              updatedAt: sql`now()`,
            },
          })
          .returning()
        const [currentUser] = yield* tx
          .insert(tenantUser)
          .values({
            organizationId,
            tenantId: customer!.id,
            externalId: identity.id,
            name: identity.name,
            metadata: identity.metadata,
            admin: identity.admin,
          })
          .onConflictDoUpdate({
            target: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.externalId],
            set: {
              name: identity.name,
              metadata: identity.metadata,
              admin: identity.admin,
              updatedAt: sql`now()`,
            },
          })
          .returning()
        return { tenant: customer!, user: currentUser! }
      }),
    )
  }).pipe(Effect.mapError(tenantDatabaseError))
}
