import { inArray } from "drizzle-orm"

import {
  agent,
  apiKey,
  configTable,
  member,
  organization,
  organizationConfiguration,
} from "../../src/db/schema.server.ts"
import type { SeedTransaction } from "./database.ts"
import { hashSeedApiKeySecret } from "./api-keys.ts"
import { SEED_DOGFOOD } from "./fixtures.ts"

/** Never overwrite real or partially provisioned dogfood configuration, even in development. */
export async function seedDogfood(
  transaction: SeedTransaction,
  userIdsByEmail: ReadonlyMap<string, string>,
): Promise<void> {
  const managedKeys = ["dogfood_organization_id", "dogfood_api_key", "dogfood_pending_setup"]
  const existing = await transaction
    .select({ key: configTable.key })
    .from(configTable)
    .where(inArray(configTable.key, managedKeys))
  if (existing.length > 0) return
  const fixture = SEED_DOGFOOD
  const ownerId = userIdsByEmail.get(fixture.ownerEmail)
  if (!ownerId) throw new Error("Seed dogfood owner is missing")
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
    name: "Dogfood Assistant",
    systemPrompt:
      "Help users understand the application. Use only the capabilities the host provides.",
  })
  await transaction.insert(organizationConfiguration).values({
    organizationId: fixture.organizationId,
    defaultAgentId: fixture.agentId,
  })
  await transaction.insert(apiKey).values({
    organizationId: fixture.organizationId,
    id: fixture.apiKeyId,
    name: "dogfood",
    prefix: "abo_",
    start: fixture.secret.slice(0, 10),
    key: hashSeedApiKeySecret(fixture.secret),
  })
  for (const [key, value] of Object.entries({
    dogfood_organization_id: fixture.organizationId,
    dogfood_api_key: `key_${fixture.organizationId}_${fixture.apiKeyId}_${fixture.secret}`,
  })) {
    await transaction.insert(configTable).values({ key, value: { key, value } })
  }
}
