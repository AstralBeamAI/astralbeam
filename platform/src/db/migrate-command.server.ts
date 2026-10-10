import { existsSync, readdirSync, readFileSync } from "node:fs"
import process from "node:process"

import { Client } from "pg"

import { APP_HANDLE } from "../lib/constants.ts"
import {
  type BundledMigration,
  type MigrationModule,
  bundledMigration,
  CONFIG_MIGRATION_LOCK_KEY,
  MIGRATION_LOG_DDL,
  executeMigration,
  pendingDatabaseMigrations,
} from "./migration-log.server.ts"

// `deno compile --include` embeds this folder. Plain `pg` keeps drizzle-orm and effect, tens of
// megabytes each, out of the binary's npm payload.
const MIGRATIONS_DIRECTORY = new URL("migrations/", import.meta.url)

function readEmbeddedMigrations(): BundledMigration[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .map((name) => {
      const scriptUrl = new URL(`${name}/migration.ts`, MIGRATIONS_DIRECTORY)
      return bundledMigration(
        name,
        readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS_DIRECTORY), "utf8"),
        existsSync(scriptUrl)
          ? {
              source: readFileSync(scriptUrl, "utf8"),
              load: () => import(scriptUrl.href) as Promise<MigrationModule>,
            }
          : undefined,
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Applies pending migrations in one transaction, or only lists them, and returns their names. */
export async function migrateDatabase(options: { dryRun: boolean }): Promise<string[]> {
  const migrations = readEmbeddedMigrations()
  if (!process.env.DATABASE_URL) throw new Error("'DATABASE_URL' environment variable is not set")
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: `${APP_HANDLE}-platform-migrate`,
    connectionTimeoutMillis: 5_000,
  })
  await client.connect()
  // Ending the connection rolls back an unfinished transaction, including every failure below.
  try {
    await client.query("begin")
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
      [CONFIG_MIGRATION_LOCK_KEY],
    )
    if (!lock.rows[0]?.locked) throw new Error("A migration run is already in progress")
    for (const statement of MIGRATION_LOG_DDL) await client.query(statement)
    const applied = await client.query<{ name: string; hash: string }>(
      "select name, hash from drizzle.__drizzle_migrations where name is not null",
    )
    const pending = pendingDatabaseMigrations(migrations, applied.rows)
    if (options.dryRun) return pending.map((migration) => migration.name)
    for (const migration of pending) {
      try {
        await executeMigration(client, migration)
      } catch (error) {
        const { code, message } = error as { code?: string; message?: string }
        throw new Error(
          `Migration '${migration.name}' failed: ${code ? `${code}: ` : ""}${message}`,
          {
            cause: error,
          },
        )
      }
    }
    await client.query("commit")
    return pending.map((migration) => migration.name)
  } finally {
    await client.end()
  }
}
