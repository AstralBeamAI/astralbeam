import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import process from "node:process"

import { Result, Schema } from "effect"
import { Client } from "pg"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { decryptDatabaseValue, encryptDatabaseValue } from "./lib/encryption.server.ts"
import { parseDatabaseEncryptionKeyring } from "./lib/database-credentials.server.ts"
import { bundledMigration } from "./migration-log.server.ts"
import { runMigrationStatements } from "./migration-steps.server.ts"
import { ModelProviderCredentialsPayloadSchema } from "../lib/model-providers/schemas.ts"

const migrationIntegrationUrl = process.env.DATABASE_URL
const migrationIntegrationEnabled =
  migrationIntegrationUrl && migrationIntegrationUrl !== "postgres://test:test@127.0.0.1:5432/test"
if (migrationIntegrationEnabled) {
  const url = new URL(migrationIntegrationUrl)
  if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_test")) {
    throw new Error("Use a disposable loopback database ending in _test")
  }
}

const modelKeyMigrationName = "20261001165317_migrate_organization_model_keys"
const modelKeyMigrationDirectory = new URL("migrations/", import.meta.url)
const modelKeyMigration = bundledMigration(
  modelKeyMigrationName,
  readFileSync(
    new URL(`${modelKeyMigrationName}/migration.sql`, modelKeyMigrationDirectory),
    "utf8",
  ),
  readFileSync(
    new URL(`${modelKeyMigrationName}/data.server.ts`, modelKeyMigrationDirectory),
    "utf8",
  ),
)
const migrationOldSecret = "old-model-key-migration-secret-0000"
const migrationNewSecret = "new-model-key-migration-secret-0000"
const migrationApiKey = `sk-${"migration".repeat(4)}`

function migrationLegacyCiphertext(organizationId: string, value?: unknown): string {
  return Result.getOrThrow(
    encryptDatabaseValue({
      value: value ?? { organizationId, apiKey: migrationApiKey },
      schema: Schema.Unknown,
      keyring: parseDatabaseEncryptionKeyring(migrationOldSecret),
    }),
  )
}

async function createMigrationOrganization(client: Client, name: string) {
  const { rows } = await client.query<{ id: string }>(
    "INSERT INTO organization (name, slug) VALUES ($1, $1) RETURNING id",
    [name],
  )
  const organizationId = rows[0]!.id
  await client.query(
    "INSERT INTO organization_configuration (organization_id, openai_api_key) VALUES ($1, $2)",
    [organizationId, migrationLegacyCiphertext(organizationId)],
  )
  await client.query(
    "INSERT INTO agent (organization_id, name, system_prompt) VALUES ($1, 'Assistant', 'Help')",
    [organizationId],
  )
  return organizationId
}

describe.skipIf(!migrationIntegrationEnabled)("automatic organization model key migration", () => {
  let client: Client
  let isolatedSchema: string
  beforeEach(async () => {
    vi.stubEnv("DATABASE_ENCRYPTION_KEY", `${migrationNewSecret},${migrationOldSecret}`)
    client = new Client({ connectionString: migrationIntegrationUrl })
    await client.connect()
    await client.query("BEGIN")
    isolatedSchema = `model_key_migration_${randomUUID().replaceAll("-", "")}`
    await client.query(`CREATE SCHEMA ${isolatedSchema}`)
    await client.query(`SET LOCAL search_path TO ${isolatedSchema}, public`)
    for (const name of readdirSync(modelKeyMigrationDirectory).sort()) {
      if (name >= modelKeyMigrationName) continue
      const sql = readFileSync(new URL(`${name}/migration.sql`, modelKeyMigrationDirectory), "utf8")
      await runMigrationStatements(client, bundledMigration(name, sql))
    }
  })
  afterEach(async () => {
    await client.query("ROLLBACK")
    await client.end()
    vi.unstubAllEnvs()
  })

  test("rewraps with the active key, preserves selected models, and resolves case-insensitive name collisions", async () => {
    const organizationId = await createMigrationOrganization(client, "legacy")
    const emptyOrganizationId = await createMigrationOrganization(client, "empty")
    await client.query(
      "UPDATE organization_configuration SET openai_api_key = NULL WHERE organization_id = $1",
      [emptyOrganizationId],
    )
    const { rows: oldProviders } = await client.query<{ id: string }>(
      `INSERT INTO model_provider (organization_id, name, provider_type, api, base_url)
       VALUES ($1, 'OPENAI', 'openai', 'chat-completions', 'https://custom.example/v1') RETURNING id`,
      [organizationId],
    )
    const { rows: oldModels } = await client.query<{ id: string }>(
      `INSERT INTO provider_model (organization_id, model_provider_id, model_id, name)
       VALUES ($1, $2, 'existing-model', 'Existing model') RETURNING id`,
      [organizationId, oldProviders[0]!.id],
    )
    const { rows: assignedAgents } = await client.query<{ id: string }>(
      "INSERT INTO agent (organization_id, name, system_prompt) VALUES ($1, 'Selected', 'Help') RETURNING id",
      [organizationId],
    )
    await client.query(
      "INSERT INTO agent_model (organization_id, agent_id, provider_model_id, position) VALUES ($1, $2, $3, 0)",
      [organizationId, assignedAgents[0]!.id, oldModels[0]!.id],
    )
    await runMigrationStatements(client, modelKeyMigration)
    const { rows: providers } = await client.query<{ id: string; credentials: string }>(
      "SELECT id, credentials FROM model_provider WHERE organization_id = $1 AND name = 'OpenAI 2'",
      [organizationId],
    )
    expect(providers).toHaveLength(1)
    expect(
      Result.getOrThrow(
        decryptDatabaseValue({
          storedValue: providers[0]!.credentials,
          schema: ModelProviderCredentialsPayloadSchema,
          keyring: parseDatabaseEncryptionKeyring(`${migrationNewSecret},${migrationOldSecret}`),
        }),
      ),
    ).toEqual({
      value: {
        organizationId,
        modelProviderId: providers[0]!.id,
        providerType: "openai",
        apiKey: migrationApiKey,
      },
      usedFallbackKey: false,
    })
    const { rows: assignments } = await client.query(
      `SELECT agent.name, agent.lock_version, provider_model.model_id
       FROM agent JOIN agent_model ON agent_model.organization_id = agent.organization_id AND agent_model.agent_id = agent.id
       JOIN provider_model ON provider_model.organization_id = agent_model.organization_id AND provider_model.id = agent_model.provider_model_id
       ORDER BY agent.name`,
    )
    expect(assignments).toEqual([
      { name: "Assistant", lock_version: 1, model_id: "gpt-5.6-terra" },
      { name: "Selected", lock_version: 0, model_id: "existing-model" },
    ])
    expect((await client.query("SELECT 1 FROM model_provider")).rows).toHaveLength(2)
    expect(
      (
        await client.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'organization_configuration' AND column_name = 'openai_api_key'",
          [isolatedSchema],
        )
      ).rows,
    ).toEqual([])
  })

  test.each(["missing-key", "wrong-key", "malformed", "wrong-organization", "extra-field"])(
    "rolls back every converted row and preserves the column on %s, then permits retry",
    async (invalid) => {
      const firstId = await createMigrationOrganization(client, "first")
      const secondId = await createMigrationOrganization(client, "second")
      if (invalid === "missing-key") vi.stubEnv("DATABASE_ENCRYPTION_KEY", "")
      if (invalid === "wrong-key") vi.stubEnv("DATABASE_ENCRYPTION_KEY", migrationNewSecret)
      if (["malformed", "wrong-organization", "extra-field"].includes(invalid)) {
        const ciphertext =
          invalid === "malformed"
            ? "unreadable"
            : migrationLegacyCiphertext(secondId, {
                organizationId: invalid === "wrong-organization" ? firstId : secondId,
                apiKey: migrationApiKey,
                ...(invalid === "extra-field" ? { extra: true } : {}),
              })
        await client.query(
          "UPDATE organization_configuration SET openai_api_key = $2 WHERE organization_id = $1",
          [secondId, ciphertext],
        )
      }
      await client.query("SAVEPOINT conversion")
      await expect(runMigrationStatements(client, modelKeyMigration)).rejects.toThrow()
      await client.query("ROLLBACK TO SAVEPOINT conversion")
      expect((await client.query("SELECT 1 FROM model_provider")).rows).toEqual([])
      expect((await client.query("SELECT 1 FROM agent_model")).rows).toEqual([])
      expect(
        (
          await client.query(
            "SELECT 1 FROM organization_configuration WHERE openai_api_key IS NOT NULL",
          )
        ).rows,
      ).toHaveLength(2)
      vi.stubEnv("DATABASE_ENCRYPTION_KEY", `${migrationNewSecret},${migrationOldSecret}`)
      await client.query(
        "UPDATE organization_configuration SET openai_api_key = $2 WHERE organization_id = $1",
        [secondId, migrationLegacyCiphertext(secondId)],
      )
      await runMigrationStatements(client, modelKeyMigration)
      expect((await client.query("SELECT 1 FROM model_provider")).rows).toHaveLength(2)
    },
  )

  test("refuses SQL-only column removal and requires no encryption key when no stored key remains", async () => {
    const organizationId = await createMigrationOrganization(client, "guarded")
    await client.query("SAVEPOINT sql_only")
    await expect(client.query(modelKeyMigration.sql)).rejects.toThrow(
      "application migration runner",
    )
    await client.query("ROLLBACK TO SAVEPOINT sql_only")
    await client.query(
      "UPDATE organization_configuration SET openai_api_key = NULL WHERE organization_id = $1",
      [organizationId],
    )
    vi.stubEnv("DATABASE_ENCRYPTION_KEY", "")
    await runMigrationStatements(client, modelKeyMigration)
    expect((await client.query("SELECT 1 FROM model_provider")).rows).toEqual([])
  })
})
