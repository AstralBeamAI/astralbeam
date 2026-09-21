import { inArray } from "drizzle-orm"

import {
  agent,
  configTable,
  member,
  organization,
  organizationConfiguration,
} from "../../src/db/schema.server.ts"
import type { SeedTransaction } from "./database.ts"
import { SEED_INTERNAL } from "./fixtures.ts"

/** Never overwrite real or partially provisioned internal configuration, even in development. */
export async function seedInternal(
  transaction: SeedTransaction,
  userIdsByEmail: ReadonlyMap<string, string>,
): Promise<void> {
  const managedKeys = [
    "internal_organization_id",
    "internal_pending_setup",
  ]
  const existing = await transaction.select({ key: configTable.key }).from(configTable).where(
    inArray(configTable.key, managedKeys),
  )
  if (existing.length > 0) return
  const fixture = SEED_INTERNAL
  const ownerId = userIdsByEmail.get(fixture.ownerEmail)
  if (!ownerId) throw new Error("Seed internal owner is missing")
  await transaction.insert(organization).values({
    id: fixture.organizationId,
    name: fixture.name,
    slug: fixture.slug,
  })
  await transaction.insert(member).values({
    organizationId: fixture.organizationId,
    userId: ownerId,
    role: "owner",
  })
  await transaction.insert(agent).values({
    organizationId: fixture.organizationId,
    id: fixture.agentId,
    name: "Internal Assistant",
    systemPrompt:
      "Help users understand the application. Use only the capabilities the host provides.",
  })
  await transaction.insert(organizationConfiguration).values({
    organizationId: fixture.organizationId,
    defaultAgentId: fixture.agentId,
  })
  const key = "internal_organization_id"
  await transaction.insert(configTable).values({
    key,
    value: { key, value: fixture.organizationId },
  })
}
