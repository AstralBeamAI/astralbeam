import { createHash } from "node:crypto"
import type { Pool, PoolClient } from "pg"

import { approvedMigrationsMatch } from "./migration-approval.server.ts"

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
    // v0.15 removed the already-applied conversion script while retaining its SQL.
    // https://github.com/AstralBeamAI/astralbeam/pull/235
    const historicalConversion =
      migration.name === "20261001165317_migrate_organization_model_keys" &&
      hash === "0725692a5954f98fdc993833a1e53897a5a619eecda95b7b5fca6fac79f1922a" &&
      migration.hash === "b51cf54bda3f65ab4dd08c41cd61d230f431398732ac2a1c505902ea34f46147"
    if (hash !== migration.hash && !historicalConversion) {
      throw new Error(
        `Migration '${migration.name}' differs from its applied history. Restore the original files and use a new migration for changes.`,
      )
    }
    return false
  })
}

export function migrationErrorDetail(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined
  return (typeof code === "string" ? `${code}: ${message}` : message).slice(0, 300)
}

/** Each migration owns a transaction, including its lock and freshly checked history. */
export async function runDatabaseMigrations(
  pool: Pick<Pool, "connect">,
  migrations: readonly BundledMigration[],
  options: {
    dryRun?: boolean
    approved?: readonly { readonly name: string; readonly hash: string }[]
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
              await client.query<{ name: string; hash: string }>(
                "select name, hash from drizzle.__drizzle_migrations where name is not null",
              )
            ).rows
          : []
        const pending = pendingDatabaseMigrations(migrations, history)
        if (approved && !approvedMigrationsMatch(pending, approved)) {
          throw new Error("The pending migrations changed; review them again")
        }
        const migration = pending[0]
        if (options.dryRun || !migration) {
          await client.query("rollback")
          return options.dryRun ? pending.map(({ name }) => name) : appliedNames
        }
        if (!exists) {
          for (const statement of MIGRATION_LOG_DDL) await client.query(statement)
        }
        try {
          await executeMigration(client, migration)
          if (connectionError) throw connectionError
          await client.query("commit")
        } catch (cause) {
          throw new Error(`Migration '${migration.name}' failed: ${migrationErrorDetail(cause)}`, {
            cause,
          })
        }
        appliedNames.push(migration.name)
        approved = approved?.slice(1)
      } catch (cause) {
        await client.query("rollback").catch(() => undefined)
        throw cause
      }
    }
  } finally {
    client.off("error", onError)
    client.release(connectionError)
  }
}

// The caller owns the transaction. Keep SQL, TypeScript, and history on its exact client.
// Upstream TypeScript migration support: https://github.com/drizzle-team/drizzle-orm/issues/2695
async function executeMigration(client: MigrationClient, migration: BundledMigration) {
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
