import { readdirSync, readFileSync } from "node:fs"
import process from "node:process"

import { Client } from "pg"

import { APP_HANDLE } from "../lib/constants.ts"
import {
  type BundledMigration,
  bundledMigration,
  CONFIG_MIGRATION_LOCK_KEY,
  MIGRATION_LOG_DDL,
} from "./migration-log.server.ts"

// `deno compile --include` embeds this folder. Plain `pg` keeps drizzle-orm and effect, tens of
// megabytes each, out of the binary's npm payload.
const MIGRATIONS_DIRECTORY = new URL("migrations/", import.meta.url)

function readEmbeddedMigrations(): BundledMigration[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .map((name) =>
      bundledMigration(
        name,
        readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS_DIRECTORY), "utf8"),
      ),
    )
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
    const applied = await client.query<{ name: string | null }>(
      "select name from drizzle.__drizzle_migrations",
    )
    const appliedNames = new Set(applied.rows.map((row) => row.name))
    const pending = migrations.filter((migration) => !appliedNames.has(migration.name))
    if (options.dryRun) return pending.map((migration) => migration.name)
    for (const migration of pending) {
      try {
        for (const statement of migration.sql.split("--> statement-breakpoint")) {
          await client.query(statement)
        }
      } catch (error) {
        const { code, message } = error as { code?: string; message?: string }
        throw new Error(`Migration '${migration.name}' failed: ${code}: ${message}`, {
          cause: error,
        })
      }
      await client.query(
        'insert into drizzle.__drizzle_migrations ("hash", "created_at", "name") values ($1, $2, $3)',
        [migration.hash, migration.folderMillis, migration.name],
      )
    }
    await client.query("commit")
    return pending.map((migration) => migration.name)
  } finally {
    await client.end()
  }
}
