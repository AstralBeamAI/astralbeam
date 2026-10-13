import { createHash } from "node:crypto"
import type { Pool, PoolClient } from "pg"

const CONFIG_MIGRATION_LOCK_KEY = "config_migrations"

// Keep the bookkeeping format compatible with existing Drizzle migration history.
const MIGRATION_LOG_DDL = [
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
  folderMillis: number
  typescript?: string
  load?: () => Promise<MigrationModule>
}

export type MigrationClient = PoolClient

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
    folderMillis: folderMillisFromName(name),
    ...(script ? { typescript: script.source, load: script.load } : {}),
  }
}

export function pendingDatabaseMigrations(
  migrations: readonly BundledMigration[],
  applied: readonly { name: string }[],
): BundledMigration[] {
  const appliedNames = new Set(applied.map(({ name }) => name))
  return migrations.filter(({ name }) => !appliedNames.has(name))
}

export function migrationErrorDetail(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined
  return (typeof code === "string" ? `${code}: ${message}` : message).slice(0, 300)
}

// Each migration owns a transaction, including its lock and freshly checked history.
// Upstream TypeScript migration support: https://github.com/drizzle-team/drizzle-orm/issues/2695
export async function runDatabaseMigrations(
  pool: Pick<Pool, "connect">,
  migrations: readonly BundledMigration[],
  options: {
    dryRun?: boolean
    approved?: readonly string[]
  } = {},
): Promise<string[]> {
  const client = await pool.connect()
  const appliedNames: string[] = []
  let approved = options.approved
  let connectionError: Error | undefined
  const onError = (error: Error) => {
    connectionError = error
  }
  // Checked-out clients emit their own errors. Never commit after losing this connection.
  // https://node-postgres.com/apis/client#events
  client.on("error", onError)
  try {
    for (;;) {
      let migration: BundledMigration | undefined
      await client.query("begin")
      try {
        const lock = await client.query<{ locked: boolean }>(
          "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
          [CONFIG_MIGRATION_LOCK_KEY],
        )
        if (!lock.rows[0]?.locked) throw new Error("A migration run is already in progress")
        const journal = await client.query<{ name: string | null }>(
          "select to_regclass('drizzle.__drizzle_migrations')::text as name",
        )
        const exists = Boolean(journal.rows[0]?.name)
        const history = exists
          ? (
              await client.query<{ name: string }>(
                "select name from drizzle.__drizzle_migrations where name is not null",
              )
            ).rows
          : []
        const pending = pendingDatabaseMigrations(migrations, history)
        if (
          approved &&
          (pending.length !== approved.length ||
            pending.some(({ name }, index) => name !== approved![index]))
        ) {
          throw new Error("The pending migrations changed; review them again")
        }
        if (options.dryRun || pending.length === 0) {
          await client.query("rollback")
          return options.dryRun ? pending.map(({ name }) => name) : appliedNames
        }
        if (!exists) {
          for (const statement of MIGRATION_LOG_DDL) await client.query(statement)
        }
        migration = pending[0]!
        for (const statement of migration.sql.split("--> statement-breakpoint")) {
          await client.query(statement)
        }
        if (migration.load) {
          const { up } = await migration.load()
          await up(client)
        }
        await client.query(
          'insert into drizzle.__drizzle_migrations ("hash", "created_at", "name") values ($1, $2, $3)',
          [
            createHash("sha256").update(migration.sql).digest("hex"),
            migration.folderMillis,
            migration.name,
          ],
        )
        if (connectionError) throw connectionError
        await client.query("commit")
        appliedNames.push(migration.name)
        approved = approved?.slice(1)
      } catch (cause) {
        await client.query("rollback").catch(() => undefined)
        if (!migration) throw cause
        throw new Error(`Migration '${migration.name}' failed: ${migrationErrorDetail(cause)}`, {
          cause,
        })
      }
    }
  } finally {
    client.off("error", onError)
    client.release(connectionError)
  }
}
