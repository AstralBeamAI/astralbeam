import { sql } from "drizzle-orm"

import { db } from "@/db"
import { sqlState } from "@/db/lib/sqlstate.server"
import { approvedMigrationsMatch } from "@/db/migration-approval.server"
import {
  type BundledMigration,
  bundledMigration,
  CONFIG_MIGRATION_LOCK_KEY,
  MIGRATION_LOG_DDL,
} from "@/db/migration-log.server"

// Vite inlines the migration SQL at build time because the built server has no migrations folder
// on disk. https://vite.dev/guide/features#glob-import
const migrationSqlByPath = import.meta.glob("/src/db/migrations/*/migration.sql", {
  query: "?raw",
  import: "default",
  eager: true,
})

function bundledMigrations(): BundledMigration[] {
  return Object.entries(migrationSqlByPath)
    .map(([path, migrationSql]) => bundledMigration(path.split("/").at(-2) ?? path, migrationSql))
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
  const code = sqlState(error)
  return code === "42P01" || code === "3F000"
}

function appliedNameSet(rows: Iterable<object | undefined>): Set<string> {
  const names = new Set<string>()
  for (const row of rows) {
    if (row && "name" in row && typeof row.name === "string") names.add(row.name)
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
  return (cachedMigrationState ??= loadMigrationState().catch((error) => {
    cachedMigrationState = undefined
    throw error
  }))
}

type ApplyMigrationsResult = { ok: true; applied: string[] } | { ok: false; error: string }

export async function runWithMigrationAdvisoryLock(
  database: Pick<typeof db, "transaction">,
  applyMigrations: () => Promise<ApplyMigrationsResult>,
): Promise<ApplyMigrationsResult> {
  return await database.transaction(async (transaction) => {
    const lockResult = await transaction.execute<{ locked: boolean }>(sql`
      select pg_try_advisory_xact_lock(hashtext(${CONFIG_MIGRATION_LOCK_KEY})) as locked
    `)
    const lock = lockResult.rows[0]
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
  // transaction open so its advisory lock remains pinned while root database transactions use
  // other clients from the shared pool to preserve one transaction per migration.
  try {
    return await runWithMigrationAdvisoryLock(db, async () => {
      let appliedNames: Set<string> | null
      try {
        const result = await db.execute(sql`select name from drizzle.__drizzle_migrations`)
        appliedNames = appliedNameSet(result.rows)
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
        for (const statement of MIGRATION_LOG_DDL) await db.execute(sql.raw(statement))
      }
      const applied: string[] = []
      for (const migration of pending) {
        try {
          await db.transaction(async (transaction) => {
            for (const statement of migration.sql.split("--> statement-breakpoint")) {
              await transaction.execute(sql.raw(statement))
            }
            await transaction.execute(sql`
              insert into drizzle.__drizzle_migrations ("hash", "created_at", "name")
              values (${migration.hash}, ${migration.folderMillis}, ${migration.name})
            `)
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
    cachedMigrationState = undefined
  }
}
