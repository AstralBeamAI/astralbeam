import { Result } from "effect"
import { Client } from "pg"

import { parseDatabaseEncryptionKeyring } from "../src/db/lib/database-credentials.server.ts"
import { encryptDatabaseValue } from "../src/db/lib/encryption.server.ts"
import { OrganizationOpenaiApiKeyPayloadSchema } from "../src/db/schema/organizations.server.ts"
import { e2eDatabaseUrl, operatorKey } from "./worktree.ts"

// The deprecated setting has no write UI. Seed only its pre-upgrade state, then import through UI.
export async function seedLegacyModelProvider(organizationId: string, agentName: string) {
  const url = new URL(e2eDatabaseUrl)
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_e2e")
  ) {
    throw new Error("Legacy fixtures require the disposable local end-to-end database")
  }
  const encryptedKey = Result.getOrThrow(
    encryptDatabaseValue({
      value: { organizationId, apiKey: "sk-browser-legacy-fixture-5555" },
      schema: OrganizationOpenaiApiKeyPayloadSchema,
      keyring: parseDatabaseEncryptionKeyring(operatorKey),
    }),
  )
  const client = new Client({ connectionString: e2eDatabaseUrl })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>(
      `WITH legacy AS (
         UPDATE organization_configuration
         SET openai_api_key = $2, lock_version = lock_version + 1, updated_at = now()
         WHERE organization_id = $1
         RETURNING organization_id
       )
       INSERT INTO agent (organization_id, name, system_prompt)
       SELECT organization_id, $3, 'Help the user with their application.' FROM legacy
       RETURNING id`,
      [organizationId, encryptedKey, agentName],
    )
    if (!rows[0]) throw new Error("The fixture organization configuration is missing")
    return rows[0].id
  } finally {
    await client.end()
  }
}
