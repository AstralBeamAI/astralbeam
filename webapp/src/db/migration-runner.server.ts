import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"
import postgres from "postgres"

import { db } from "@/db/index.server"
import { getDatabaseUrl } from "@/db/lib/database-credentials.server"
import { hasPostgresErrorCode } from "@/db/lib/postgres-errors.server"
import { approvedMigrationsMatch } from "@/db/migration-approval.server"

const CONFIG_MIGRATION_LOCK_KEY = "config_migrations"

interface BundledMigration {
  name: string
  sql: string
  hash: string
  folderMillis: number
}

// Vite inlines the migration SQL at build time because the built server has no migrations folder
// on disk. https://vite.dev/guide/features#glob-import
const migrationSqlByPath = import.meta.glob("/src/db/migrations/*/migration.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

// Timestamp parsing mirrors drizzle-orm's migrator so /configure and `deno task db migrate` stay
// interchangeable on the same bookkeeping table.
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

function bundledMigrations(): BundledMigration[] {
  return Object.entries(migrationSqlByPath)
    .map(([path, migrationSql]) => {
      const name = path.split("/").at(-2) ?? path
      return {
        name,
        sql: migrationSql,
        hash: createHash("sha256").update(migrationSql).digest("hex"),
        folderMillis: folderMillisFromName(name),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// `appliedNames === null` means the bookkeeping table (or its schema) does not exist yet, so every
// bundled migration is pending; drizzle-orm matches applied migrations by name.
function pendingMigrations(
  bundled: BundledMigration[],
  appliedNames: Set<string> | null,
): BundledMigration[] {
  if (appliedNames === null) return bundled
  return bundled.filter((migration) => !appliedNames.has(migration.name))
}

function isMissingBookkeepingError(error: unknown): boolean {
  // 42P01 = undefined table, 3F000 = the drizzle schema itself is missing.
  return hasPostgresErrorCode(error, ["42P01", "3F000"])
}

function appliedNameSet(rows: Iterable<object | undefined>): Set<string> {
  const names = new Set<string>()
  for (const row of rows) {
    const name = (row as { name?: unknown } | undefined)?.name
    if (typeof name === "string") names.add(name)
  }
  return names
}

async function listAppliedMigrationNames(): Promise<Set<string> | null> {
  try {
    const result = await db.execute(sql`select name from drizzle.__drizzle_migrations`)
    return appliedNameSet(result.rows)
  } catch (error) {
    if (isMissingBookkeepingError(error)) return null
    throw error
  }
}

interface MigrationState {
  pending: BundledMigration[]
  appliedCount: number
}

let cachedMigrationState: Promise<MigrationState> | undefined

async function loadMigrationState(): Promise<MigrationState> {
  const appliedNames = await listAppliedMigrationNames()
  return {
    pending: pendingMigrations(bundledMigrations(), appliedNames),
    appliedCount: appliedNames?.size ?? 0,
  }
}

export function getDatabaseMigrationState(): Promise<MigrationState> {
  return cachedMigrationState ??= loadMigrationState().catch((error) => {
    cachedMigrationState = undefined
    throw error
  })
}

type ApplyMigrationsResult =
  | { ok: true; applied: string[] }
  | { ok: false; error: string }

function createSingleConnectionClient(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, { max: 1 })
}

export async function runWithMigrationAdvisoryLock(
  lockClient: postgres.Sql,
  applyMigrations: () => Promise<ApplyMigrationsResult>,
): Promise<ApplyMigrationsResult> {
  return await lockClient.begin(async (lockTransaction) => {
    const [lock] = await lockTransaction`
      select pg_try_advisory_xact_lock(hashtext(${CONFIG_MIGRATION_LOCK_KEY})) as locked
    `
    if (!lock?.locked) return { ok: false, error: "A migration run is already in progress" }
    return await applyMigrations()
  })
}

function migrationErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    const detail = typeof code === "string" ? `${code}: ${error.message}` : error.message
    return detail.slice(0, 300)
  }
  return "unexpected error"
}

export async function applyApprovedMigrations(
  approvedMigrations: { name: string; hash: string }[],
): Promise<ApplyMigrationsResult> {
  // Transaction pooling can change the backing PostgreSQL session between transactions. Keep a
  // transaction open on a dedicated client so its advisory lock remains pinned while a second
  // client preserves the existing one-transaction-per-migration behavior.
  const databaseUrl = getDatabaseUrl()
  const lockClient = createSingleConnectionClient(databaseUrl)
  const migrationClient = createSingleConnectionClient(databaseUrl)
  try {
    return await runWithMigrationAdvisoryLock(lockClient, async () => {
      let appliedNames: Set<string> | null
      try {
        appliedNames = appliedNameSet(
          await migrationClient`select name from drizzle.__drizzle_migrations`,
        )
      } catch (error) {
        if (!isMissingBookkeepingError(error)) throw error
        appliedNames = null
      }
      const pending = pendingMigrations(bundledMigrations(), appliedNames)
      // The operator approves exactly the SQL digests they reviewed; abort if anything changed.
      if (!approvedMigrationsMatch(pending, approvedMigrations)) {
        return { ok: false, error: "The pending migrations changed; review them again" }
      }
      if (appliedNames === null) {
        // Same bookkeeping DDL as drizzle-orm's migrator, so the drizzle-kit CLI remains usable.
        await migrationClient`CREATE SCHEMA IF NOT EXISTS drizzle`
        await migrationClient.unsafe(
          `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint,
            name text,
            applied_at timestamp with time zone DEFAULT now()
          )`,
        )
      }
      const applied: string[] = []
      for (const migration of pending) {
        try {
          await migrationClient.begin(async (transaction) => {
            for (const statement of migration.sql.split("--> statement-breakpoint")) {
              await transaction.unsafe(statement)
            }
            await transaction`
              insert into drizzle.__drizzle_migrations ("hash", "created_at", "name")
              values (${migration.hash}, ${migration.folderMillis}, ${migration.name})
            `
          })
        } catch (error) {
          console.error(`Migration '${migration.name}' failed`)
          return {
            ok: false,
            error: `Migration '${migration.name}' failed: ${migrationErrorDetail(error)}`,
          }
        }
        applied.push(migration.name)
      }
      return { ok: true, applied }
    })
  } finally {
    await Promise.all([lockClient.end(), migrationClient.end()])
    cachedMigrationState = undefined
  }
}
