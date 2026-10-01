import process from "node:process"
import type { Client } from "pg"

import { decryptDatabaseJson, encryptDatabaseJson } from "../../lib/database-cipher.server.ts"
import {
  type DatabaseEncryptionKeyring,
  parseDatabaseEncryptionKeyring,
} from "../../lib/database-credentials.server.ts"

type OrganizationModelKeyMigrationClient = Pick<Client, "query">

export async function migrateOrganizationModelKeys(
  client: OrganizationModelKeyMigrationClient,
): Promise<void> {
  // Hold writes until the runner commits the conversion and column removal together.
  // https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES
  await client.query(
    "LOCK TABLE organization_configuration, agent, model_provider, provider_model, agent_model IN SHARE ROW EXCLUSIVE MODE",
  )
  const legacy = await client.query<{ organization_id: string; openai_api_key: string }>(
    "SELECT organization_id, openai_api_key FROM organization_configuration WHERE openai_api_key IS NOT NULL ORDER BY organization_id",
  )
  if (legacy.rows.length === 0) return
  const keyring = parseDatabaseEncryptionKeyring(process.env.DATABASE_ENCRYPTION_KEY)
  for (const row of legacy.rows) {
    const decrypted = decryptDatabaseJson({ storedValue: row.openai_api_key, keyring })
    if (!decrypted || !isLegacyOrganizationModelKey(decrypted.value, row.organization_id)) {
      throw new Error("Stored organization model credentials could not be migrated")
    }
    await migrateOrganizationModelKey(client, {
      organizationId: row.organization_id,
      apiKey: decrypted.value.apiKey,
      keyring,
    })
  }
}

function isLegacyOrganizationModelKey(
  value: unknown,
  organizationId: string,
): value is { organizationId: string; apiKey: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    "organizationId" in value &&
    value.organizationId === organizationId &&
    /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(organizationId) &&
    "apiKey" in value &&
    typeof value.apiKey === "string" &&
    /^sk-[\w-]{16,500}$/.test(value.apiKey)
  )
}

async function migrateOrganizationModelKey(
  client: OrganizationModelKeyMigrationClient,
  options: { organizationId: string; apiKey: string; keyring: DatabaseEncryptionKeyring },
): Promise<void> {
  const { rows: identifiers } = await client.query<{ id: string }>("SELECT uuidv7()::text AS id")
  const modelProviderId = identifiers[0]!.id
  const credentials = encryptDatabaseJson({
    value: {
      organizationId: options.organizationId,
      modelProviderId,
      providerType: "openai",
      apiKey: options.apiKey,
    },
    keyring: options.keyring,
  })
  if (!credentials) throw new Error("Stored organization model credentials could not be migrated")
  const name = await migratedOrganizationProviderName(client, options.organizationId)
  await client.query(
    `INSERT INTO model_provider (organization_id, id, name, provider_type, api, base_url, credentials)
     VALUES ($1, $2, $3, 'openai', 'responses', 'https://api.openai.com/v1', $4)`,
    [options.organizationId, modelProviderId, name, credentials],
  )
  const { rows: models } = await client.query<{ id: string }>(
    `INSERT INTO provider_model (organization_id, model_provider_id, model_id, name)
     VALUES ($1, $2, 'gpt-5.6-terra', 'GPT-5.6 Terra') RETURNING id`,
    [options.organizationId, modelProviderId],
  )
  await client.query(
    `WITH assigned AS (
       INSERT INTO agent_model (organization_id, agent_id, provider_model_id, position)
       SELECT organization_id, id, $2, 0 FROM agent
       WHERE organization_id = $1 AND NOT EXISTS (
         SELECT 1 FROM agent_model WHERE agent_model.organization_id = agent.organization_id
         AND agent_model.agent_id = agent.id
       ) RETURNING agent_id
     )
     UPDATE agent SET lock_version = lock_version + 1, updated_at = now()
     WHERE organization_id = $1 AND id IN (SELECT agent_id FROM assigned)`,
    [options.organizationId, models[0]!.id],
  )
  await client.query(
    `UPDATE organization_configuration SET openai_api_key = NULL,
     lock_version = lock_version + 1, updated_at = now() WHERE organization_id = $1`,
    [options.organizationId],
  )
}

async function migratedOrganizationProviderName(
  client: OrganizationModelKeyMigrationClient,
  organizationId: string,
): Promise<string> {
  let suffix = 1
  while (true) {
    const name = suffix === 1 ? "OpenAI" : `OpenAI ${suffix}`
    const existing = await client.query(
      "SELECT 1 FROM model_provider WHERE organization_id = $1 AND name = $2",
      [organizationId, name],
    )
    if (existing.rows.length === 0) return name
    suffix += 1
  }
}
