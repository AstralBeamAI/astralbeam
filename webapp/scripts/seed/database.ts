import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { loadEnv } from "vite"

const webappDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const migrationsDirectory = join(webappDirectory, "src", "db", "migrations")

/**
 * Seeding is destructive-adjacent and writes fixed credentials, so it is restricted to a database
 * reachable only from this machine. An operator who needs a remote database can still tunnel it to
 * loopback, which is an explicit act rather than a typo in `DATABASE_URL`.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Mirrors how the application and `drizzle.config.ts` see configuration: `.env`, `.env.local`,
 * `.env.development`, and `.env.development.local` supply defaults, and an existing shell value
 * always wins. Merging into `process.env` also lets the encrypted-column codec read
 * `DATABASE_ENCRYPTION_KEY`, and lets the config step detect the same environment overrides the
 * running server would. https://vite.dev/guide/env-and-mode
 */
export function loadSeedEnvironment(): void {
  for (const [key, value] of Object.entries(loadEnv("development", webappDirectory, ""))) {
    if (!process.env[key]) process.env[key] = value
  }
}

export function resolveSeedDatabaseUrl(): { url: string; databaseName: string } {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is required; run this from the `webapp` directory")
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("DATABASE_URL is not a valid URL")
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Refusing to seed the database at '${parsed.hostname}': seeding writes fixed development credentials and is limited to a loopback host`,
    )
  }
  if (!process.env.DATABASE_ENCRYPTION_KEY) {
    throw new Error("DATABASE_ENCRYPTION_KEY is required to write encrypted configuration values")
  }
  return { url, databaseName: decodeURIComponent(parsed.pathname.slice(1)) }
}

export function createSeedDatabase(url: string) {
  const pool = new Pool({ connectionString: url, application_name: "astralbeam-seed", max: 1 })
  pool.on("error", (error) => {
    console.error("Seed database pool error:", error.message)
  })
  return { pool, database: drizzle({ client: pool }) }
}

export type SeedDatabase = ReturnType<typeof createSeedDatabase>["database"]
export type SeedTransaction = Parameters<Parameters<SeedDatabase["transaction"]>[0]>[0]

/**
 * A seed against an unmigrated database fails deep inside an insert with a confusing message, so
 * the missing tables are reported up front. Applied migrations are matched by folder name, the
 * same way `src/db/migration-runner.server.ts` and drizzle-orm's own migrator do.
 */
export async function assertSeedMigrationsApplied(database: SeedDatabase): Promise<void> {
  const bundled = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
  let applied: Set<string>
  try {
    const result = await database.execute<{ name: string }>(
      sql`select name from drizzle.__drizzle_migrations`,
    )
    applied = new Set(result.rows.map((row) => row.name))
  } catch {
    applied = new Set()
  }
  const pending = bundled.filter((name) => !applied.has(name))
  if (pending.length > 0) {
    throw new Error(
      `${pending.length} migration(s) have not been applied, starting with '${
        pending[0]
      }'. Run \`deno task db migrate\` first.`,
    )
  }
}
