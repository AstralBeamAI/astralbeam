import { createHash } from "node:crypto"

import { eq, sql } from "drizzle-orm"

import { apiKey } from "../../src/db/schema.server.ts"
import {
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
} from "../../src/lib/auth/organization-api-key-configuration.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_ORGANIZATIONS } from "./fixtures.ts"

/** The shape `@astralbeam/sdk` accepts for the secret half of an organization API key. */
const SEED_API_KEY_SECRET_PATTERN = /^abo_[A-Za-z]{64}$/

export type SeedApiKeySummary = {
  readonly value: string
  readonly name: string
  readonly enabled: boolean
}

/**
 * Better Auth's `defaultKeyHasher`: an unpadded base64url SHA-256 digest of the raw key. The
 * digest is all the database ever holds, and `/api/v1/chat` verifies chat-token signatures against
 * it, so a seeded key works exactly like one created in the dashboard.
 * https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/index.ts
 */
function hashSeedApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url")
}

/**
 * Creates the organization API keys the todos example and its tests sign chat auth tokens with.
 *
 * Quota and rate-limit columns are left to their schema defaults, which already carry the
 * product's configured window, and `expiresAt` stays null to match the dashboard's Never default.
 */
export async function seedApiKeys(
  transaction: SeedTransaction,
  organizationIdsBySlug: ReadonlyMap<string, string>,
): Promise<SeedApiKeySummary[]> {
  const summaries: SeedApiKeySummary[] = []
  for (const seedOrganization of SEED_ORGANIZATIONS) {
    const organizationId = organizationIdsBySlug.get(seedOrganization.slug)
    if (!organizationId) throw new Error(`Organization '${seedOrganization.slug}' was not seeded`)

    for (const seedApiKey of seedOrganization.apiKeys) {
      if (!SEED_API_KEY_SECRET_PATTERN.test(seedApiKey.secret)) {
        throw new Error(
          `Seed API key '${seedApiKey.id}' must match ${SEED_API_KEY_SECRET_PATTERN.source}`,
        )
      }
      const digest = hashSeedApiKeySecret(seedApiKey.secret)
      const start = seedApiKey.secret.slice(0, ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH)
      const [saved] = await transaction
        .insert(apiKey)
        .values({
          organizationId,
          name: seedApiKey.name,
          id: seedApiKey.id,
          prefix: ORGANIZATION_API_KEY_PREFIX,
          start,
          key: digest,
          enabled: seedApiKey.enabled,
        })
        .onConflictDoUpdate({
          target: apiKey.id,
          set: {
            name: seedApiKey.name,
            prefix: ORGANIZATION_API_KEY_PREFIX,
            start,
            key: digest,
            enabled: seedApiKey.enabled,
            expiresAt: null,
            updatedAt: sql`now()`,
          },
          setWhere: eq(apiKey.organizationId, organizationId),
        }).returning({ id: apiKey.id })
      if (!saved) throw new Error(`Seed API key '${seedApiKey.id}' belongs to another organization`)
      summaries.push({
        value: `key_${organizationId}_${seedApiKey.id}_${seedApiKey.secret}`,
        name: seedApiKey.name,
        enabled: seedApiKey.enabled,
      })
    }
  }
  return summaries
}
