import { sql } from "drizzle-orm"

import { tenant, tenantUser } from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

/**
 * Creates the Tenants and tenant users an Organization's own customers would have.
 *
 * `/api/chat` does not persist a tenant yet: it reads identity straight from the verified chat
 * token, so these rows are sample data for dashboard and query work rather than something the
 * chat flow depends on. The seeded `acme` tenant deliberately matches the identity
 * `examples/todos` mints, so the two views line up once chat does start writing them.
 */
export async function seedTenants(
  transaction: SeedTransaction,
  organizationIdsBySlug: ReadonlyMap<string, string>,
): Promise<number> {
  let tenantUserCount = 0
  for (const seedOrganization of SEED_ORGANIZATIONS) {
    const organizationId = organizationIdsBySlug.get(seedOrganization.slug)
    if (!organizationId) throw new Error(`Organization '${seedOrganization.slug}' was not seeded`)

    for (const seedTenant of seedOrganization.tenants) {
      const [insertedTenant] = await transaction
        .insert(tenant)
        .values({ organizationId, externalId: seedTenant.externalId, name: seedTenant.name })
        .onConflictDoUpdate({
          target: [tenant.organizationId, tenant.externalId],
          set: { name: seedTenant.name, updatedAt: sql`now()` },
        })
        .returning({ id: tenant.id })
      if (!insertedTenant) {
        throw new Error(`PostgreSQL did not return a row for tenant '${seedTenant.externalId}'`)
      }

      for (const seedTenantUser of seedTenant.users) {
        await transaction
          .insert(tenantUser)
          .values({
            organizationId,
            tenantId: insertedTenant.id,
            externalId: seedTenantUser.externalId,
            name: seedTenantUser.name,
            admin: seedTenantUser.admin,
            metadata: seedTenantUser.metadata,
          })
          .onConflictDoUpdate({
            target: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.externalId],
            set: {
              name: seedTenantUser.name,
              admin: seedTenantUser.admin,
              metadata: seedTenantUser.metadata,
              updatedAt: sql`now()`,
            },
          })
        tenantUserCount += 1
      }
    }
  }
  return tenantUserCount
}
