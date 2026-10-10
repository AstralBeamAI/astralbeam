import { createHash } from "node:crypto"
import type { PoolClient } from "pg"

export const CONFIG_MIGRATION_LOCK_KEY = "config_migrations"

// Keep the bookkeeping format compatible with existing Drizzle migration history.
export const MIGRATION_LOG_DDL = [
  "CREATE SCHEMA IF NOT EXISTS drizzle",
  `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint,
    name text,
    applied_at timestamp with time zone DEFAULT now()
  )`,
]

export interface BundledMigration {
  name: string
  sql: string
  hash: string
  folderMillis: number
  typescript?: string
  load?: () => Promise<MigrationModule>
}

// Historical steps must not depend on today's Drizzle schema.
// https://github.com/drizzle-team/drizzle-orm/issues/2695#issuecomment-2831644997
export type MigrationClient = Pick<PoolClient, "query">

export interface MigrationModule {
  up: (client: MigrationClient) => Promise<void>
}

// Preserve Drizzle's timestamps while all application entrypoints share the same history.
// Migration folder format: https://github.com/drizzle-team/drizzle-orm/discussions/2832
function folderMillisFromName(name: string): number {
  const stamp = name.slice(0, 14)
  return Date.UTC(
    Number.parseInt(stamp.slice(0, 4), 10),
    Number.parseInt(stamp.slice(4, 6), 10) - 1,
    Number.parseInt(stamp.slice(6, 8), 10),
    Number.parseInt(stamp.slice(8, 10), 10),
    Number.parseInt(stamp.slice(10, 12), 10),
    Number.parseInt(stamp.slice(12, 14), 10),
  )
}

export function bundledMigration(
  name: string,
  migrationSql: string,
  script?: { source: string; load: () => Promise<MigrationModule> },
): BundledMigration {
  return {
    name,
    sql: migrationSql,
    hash: createHash("sha256")
      .update(script ? JSON.stringify([migrationSql, script.source]) : migrationSql)
      .digest("hex"),
    folderMillis: folderMillisFromName(name),
    ...(script ? { typescript: script.source, load: script.load } : {}),
  }
}

export function pendingDatabaseMigrations(
  migrations: readonly BundledMigration[],
  applied: readonly { name: string; hash: string }[],
): BundledMigration[] {
  const appliedHashes = new Map(applied.map(({ name, hash }) => [name, hash]))
  return migrations.filter((migration) => {
    const hash = appliedHashes.get(migration.name)
    if (hash === undefined) return true
    if (hash !== migration.hash) {
      throw new Error(
        `Migration '${migration.name}' differs from its applied history. Restore the original files and use a new migration for changes.`,
      )
    }
    return false
  })
}

// The caller owns the transaction. Keep SQL, TypeScript, and history on its exact client.
// Upstream TypeScript migration support: https://github.com/drizzle-team/drizzle-orm/issues/2695
export async function executeMigration(client: MigrationClient, migration: BundledMigration) {
  for (const statement of migration.sql.split("--> statement-breakpoint")) {
    await client.query(statement)
  }
  if (migration.load) {
    const { up } = await migration.load()
    if (typeof up !== "function") throw new Error("migration.ts must export an up function")
    await up(client)
  }
  await client.query(
    'insert into drizzle.__drizzle_migrations ("hash", "created_at", "name") values ($1, $2, $3)',
    [migration.hash, migration.folderMillis, migration.name],
  )
}
