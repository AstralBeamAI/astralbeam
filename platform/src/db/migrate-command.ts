import { existsSync, readdirSync, readFileSync } from "node:fs"
import process from "node:process"

import { Pool } from "pg"

import { APP_HANDLE } from "../lib/constants.ts"
import {
  type BundledMigration,
  type MigrationModule,
  bundledMigration,
  runDatabaseMigrations,
} from "./migration-log.ts"

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

/** Applies each pending migration atomically, or only lists them, and returns their names. */
export async function migrateDatabase(options: { dryRun: boolean }): Promise<string[]> {
  const migrations = readEmbeddedMigrations()
  if (!process.env.DATABASE_URL) throw new Error("'DATABASE_URL' environment variable is not set")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: `${APP_HANDLE}-platform-migrate`,
    max: 1,
    connectionTimeoutMillis: 5_000,
  })
  try {
    return await runDatabaseMigrations(pool, migrations, options)
  } finally {
    await pool.end()
  }
}
