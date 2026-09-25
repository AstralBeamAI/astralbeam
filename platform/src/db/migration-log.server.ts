import { createHash } from "node:crypto"

export const CONFIG_MIGRATION_LOCK_KEY = "config_migrations"

// Same bookkeeping DDL as drizzle-orm's migrator, so the drizzle-kit CLI remains usable.
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
}

// Timestamp parsing mirrors drizzle-orm's migrator so /configure, `migrate`, and
// `deno task db migrate` stay interchangeable on the same bookkeeping table.
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

export function bundledMigration(name: string, migrationSql: string): BundledMigration {
  return {
    name,
    sql: migrationSql,
    hash: createHash("sha256").update(migrationSql).digest("hex"),
    folderMillis: folderMillisFromName(name),
  }
}
