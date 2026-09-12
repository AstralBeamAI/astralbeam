import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { seedAgents } from "./seed/agents.ts"
import { seedApiKeys } from "./seed/api-keys.ts"
import { seedConfig } from "./seed/config.ts"
import {
  assertSeedMigrationsApplied,
  createSeedDatabase,
  loadSeedEnvironment,
  resolveSeedDatabaseUrl,
} from "./seed/database.ts"
import {
  SEED_ORGANIZATIONS,
  SEED_PASSWORD,
  SEED_TODOS_TARGET,
  SEED_USERS,
} from "./seed/fixtures.ts"
import { seedOrganizationOpenaiApiKeys, seedOrganizations } from "./seed/organizations.ts"
import { seedTenants } from "./seed/tenants.ts"
import { seedUsers } from "./seed/users.ts"

// Resolved from this file, not the cwd, so the seed writes the same path from anywhere.
const todosEnvFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "examples",
  "todos",
  ".env",
)

loadSeedEnvironment()

const { url, databaseName } = resolveSeedDatabaseUrl()
const { pool, database } = createSeedDatabase(url)

try {
  await assertSeedMigrationsApplied(database)

  // One transaction, so a failure anywhere leaves no half-seeded database behind.
  const summary = await database.transaction(async (transaction) => {
    const config = await seedConfig(transaction)
    const userIdsByEmail = await seedUsers(transaction)
    await seedOrganizations(transaction, userIdsByEmail)
    const agents = await seedAgents(transaction)
    const openaiApiKey = await seedOrganizationOpenaiApiKeys(transaction)
    const apiKeys = await seedApiKeys(transaction)
    const tenantUserCount = await seedTenants(transaction)
    return { config, agents, apiKeys, openaiApiKey, tenantUserCount }
  })

  console.log(`\nSeeded database '${databaseName}'.\n`)

  console.log("Configuration")
  for (const key of summary.config.written) console.log(`  wrote     ${key}`)
  for (const key of summary.config.fromEnvironment) {
    console.log(`  skipped   ${key} (provided by ${key.toUpperCase()})`)
  }

  console.log(`\nAccounts (password: ${SEED_PASSWORD})`)
  for (const seedUser of SEED_USERS) console.log(`  ${seedUser.email}  ${seedUser.name}`)

  console.log("\nOrganizations")
  for (const organization of SEED_ORGANIZATIONS) {
    console.log(`  ${organization.id}  ${organization.name}`)
  }

  console.log("\nAgents")
  for (const seededAgent of summary.agents) {
    const labels = [seededAgent.isDefault ? "default" : null, seededAgent.sandboxProviderName]
      .filter((label) => label !== null)
    const suffix = labels.length > 0 ? `  [${labels.join(", ")}]` : ""
    console.log(`  ${seededAgent.id}  ${seededAgent.name}${suffix}`)
  }

  console.log("\nAPI keys")
  for (const seededApiKey of summary.apiKeys) {
    console.log(`  ${seededApiKey.value}${seededApiKey.enabled ? "" : "  [disabled]"}`)
  }

  console.log(`\nTenant users: ${summary.tenantUserCount}`)

  const todosEnv =
    `ASTRALBEAM_API_KEY=${SEED_TODOS_TARGET.apiKey}\nVITE_ASTRALBEAM_AGENT_ID=${SEED_TODOS_TARGET.agentId}\n`
  // Both values are self-describing local-only fixtures and the file is gitignored, but an
  // existing one may hold a real key, so it is never overwritten.
  if (existsSync(todosEnvFile)) {
    console.log("\nexamples/todos/.env already exists and was left alone; it should hold:\n")
  } else {
    writeFileSync(todosEnvFile, todosEnv)
    console.log("\nWrote examples/todos/.env so the todos example points at this database:\n")
  }
  for (const line of todosEnv.trimEnd().split("\n")) console.log(`  ${line}`)

  if (summary.openaiApiKey === "written") {
    console.log("\nStored OPENAI_API_KEY as every seeded organization's own OpenAI API key.")
  } else {
    console.warn(
      `\nOPENAI_API_KEY is ${
        summary.openaiApiKey === "invalid" ? "not a well-formed 'sk-' key" : "not set"
      }, so chat requests answer 503 until each organization's\nkey is set in the dashboard under Settings. Put a key in webapp/.env.local to seed it instead.`,
    )
  }
  console.log()
} finally {
  await pool.end()
}
