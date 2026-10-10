import { Cache, Context, Duration, Effect, Exit, Layer, Schema } from "effect"
import type { Pool, PoolClient } from "pg"

import { getAuthDatabase } from "./database.server.ts"
import { sqlState } from "@/db/lib/sqlstate.server"
import { approvedMigrationsMatch } from "@/db/migration-approval.server"
import {
  type BundledMigration,
  type MigrationModule,
  bundledMigration,
  CONFIG_MIGRATION_LOCK_KEY,
  MIGRATION_LOG_DDL,
  executeMigration,
  pendingDatabaseMigrations,
} from "@/db/migration-log.server"

/** Carries the migration runner's reason, which names the migration and SQLSTATE for operators. */
export class MigrationsNotApplied extends Schema.TaggedError<MigrationsNotApplied>()(
  "MigrationsNotApplied",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export interface DatabaseMigrationState {
  readonly pending: readonly BundledMigration[]
  readonly appliedCount: number
  readonly error?: string
}

type MigrationApproval = { readonly name: string; readonly hash: string }

function bundledMigrations(): BundledMigration[] {
  // Vite inlines the SQL because the built server has no migrations folder. Nitro's own bundle
  // cannot, so the glob runs only when called. https://vite.dev/guide/features#glob-import
  const migrationSqlByPath = import.meta.glob<string>("/src/db/migrations/*/migration.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  })
  const migrationScripts = import.meta.glob<MigrationModule>("/src/db/migrations/*/migration.ts")
  const migrationSources = import.meta.glob<string>("/src/db/migrations/*/migration.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  })
  return Object.entries(migrationSqlByPath)
    .map(([path, migrationSql]) => {
      const scriptPath = path.replace(/migration\.sql$/, "migration.ts")
      const load = migrationScripts[scriptPath]
      return bundledMigration(
        path.split("/").at(-2) ?? path,
        migrationSql,
        load ? { source: migrationSources[scriptPath]!, load } : undefined,
      )
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

const decodeAppliedMigrations = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
)

function queryPoolClient(client: Pick<PoolClient, "query">, text: string, values?: unknown[]) {
  return Effect.tryPromise({ try: () => client.query(text, values), catch: (cause) => cause })
}

/** Runs `use` in a transaction on a pool client of its own, committing only when `use` succeeds. */
function inPoolTransaction<A, E>(
  pool: Pick<Pool, "connect">,
  use: (client: PoolClient) => Effect.Effect<A, E>,
) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => pool.connect(), catch: (cause) => cause }),
    (client) =>
      queryPoolClient(client, "begin").pipe(
        Effect.andThen(use(client)),
        Effect.tap(() => queryPoolClient(client, "commit")),
        Effect.onError(() => Effect.ignore(queryPoolClient(client, "rollback"))),
      ),
    (client) => Effect.sync(() => client.release()),
  ).pipe(Effect.uninterruptible)
}

/**
 * Holds the migration advisory lock in a transaction of its own while `apply` runs. Transaction
 * pooling can move a session between transactions, so each migration commits on another client.
 */
export const withMigrationLock = Effect.fn("withMigrationLock")(function* <A, E>(
  pool: Pick<Pool, "connect">,
  apply: Effect.Effect<A, E>,
) {
  return yield* inPoolTransaction(pool, (client) =>
    Effect.gen(function* () {
      const { rows } = yield* queryPoolClient(
        client,
        "select pg_try_advisory_xact_lock(hashtext($1)) as locked",
        [CONFIG_MIGRATION_LOCK_KEY],
      )
      if ((rows[0] as { locked?: unknown } | undefined)?.locked !== true) {
        return yield* new MigrationsNotApplied({
          message: "A migration run is already in progress",
        })
      }
      return yield* apply
    }),
  )
})

/** Applied history, or `null` before the table or its schema exists. */
const readAppliedMigrationHistory = Effect.fn("readAppliedMigrationHistory")(function* () {
  const result = yield* queryPoolClient(
    getAuthDatabase().$client,
    "select name, hash from drizzle.__drizzle_migrations where name is not null",
  ).pipe(
    // 42P01 = undefined table, 3F000 = the drizzle schema itself is missing.
    Effect.catchIf(
      (cause) => ["42P01", "3F000"].includes(sqlState(cause) ?? ""),
      () => Effect.succeed(null),
    ),
  )
  if (result === null) return null
  return yield* decodeAppliedMigrations(result.rows)
}, Effect.orDie)

// The operator who approved a migration reads its SQLSTATE and message, so both are kept.
function migrationErrorDetail(cause: unknown): string {
  if (!(cause instanceof Error)) return "unexpected error"
  const code = sqlState(cause)
  return (code ? `${code}: ${cause.message}` : cause.message).slice(0, 300)
}

const applyMigration = Effect.fn("applyMigration")(function* (migration: BundledMigration) {
  yield* inPoolTransaction(getAuthDatabase().$client, (client) =>
    Effect.tryPromise({ try: () => executeMigration(client, migration), catch: (cause) => cause }),
  ).pipe(
    Effect.tapError(() =>
      Effect.logError("Migration failed").pipe(Effect.annotateLogs({ migration: migration.name })),
    ),
    Effect.mapError(
      (cause) =>
        new MigrationsNotApplied({
          message: `Migration '${migration.name}' failed: ${migrationErrorDetail(cause)}`,
        }),
    ),
  )
})

export class DatabaseMigrations extends Context.Service<
  DatabaseMigrations,
  {
    /** Cached until this process applies migrations, which only an operator does. */
    readonly state: Effect.Effect<DatabaseMigrationState>
    /** Applies exactly the pending migrations the operator reviewed, each in its own transaction. */
    readonly apply: (
      approved: readonly MigrationApproval[],
    ) => Effect.Effect<void, MigrationsNotApplied>
  }
>()("astralbeam/db/DatabaseMigrations") {
  static readonly layer = Layer.effect(
    DatabaseMigrations,
    Effect.gen(function* () {
      const cache = yield* Cache.makeWith(
        () =>
          Effect.map(readAppliedMigrationHistory(), (applied): DatabaseMigrationState => {
            const appliedCount = applied?.length ?? 0
            try {
              return {
                pending: pendingDatabaseMigrations(bundledMigrations(), applied ?? []),
                appliedCount,
              }
            } catch (cause) {
              return { pending: [], appliedCount, error: migrationErrorDetail(cause) }
            }
          }),
        {
          capacity: 1,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
        },
      )

      const apply = Effect.fn("DatabaseMigrations.apply")(
        function* (approved: readonly MigrationApproval[]) {
          const pool = getAuthDatabase().$client
          yield* withMigrationLock(
            pool,
            Effect.gen(function* () {
              const applied = yield* readAppliedMigrationHistory()
              const pending = yield* Effect.try({
                try: () => pendingDatabaseMigrations(bundledMigrations(), applied ?? []),
                catch: (cause) =>
                  new MigrationsNotApplied({ message: migrationErrorDetail(cause) }),
              })
              // Approval binds both SQL and TypeScript source to the reviewed migration.
              if (!approvedMigrationsMatch(pending, approved)) {
                return yield* new MigrationsNotApplied({
                  message: "The pending migrations changed; review them again",
                })
              }
              if (applied === null) {
                yield* Effect.forEach(MIGRATION_LOG_DDL, (statement) =>
                  queryPoolClient(pool, statement).pipe(Effect.orDie),
                )
              }
              yield* Effect.forEach(pending, applyMigration, { discard: true })
            }),
          ).pipe(
            Effect.catch((cause) =>
              cause instanceof MigrationsNotApplied ? Effect.fail(cause) : Effect.die(cause),
            ),
          )
        },
        (effect) => Effect.ensuring(effect, Cache.invalidate(cache, "state")),
      )

      return DatabaseMigrations.of({ state: Cache.get(cache, "state"), apply })
    }),
  )
}
