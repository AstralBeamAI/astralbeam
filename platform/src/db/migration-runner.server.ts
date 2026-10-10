import { Cache, Context, Duration, Effect, Exit, Layer, Schema } from "effect"

import { getAuthDatabase } from "./database.server.ts"
import { sqlState } from "@/db/lib/sqlstate.server"
import {
  type BundledMigration,
  type MigrationModule,
  bundledMigration,
  migrationErrorDetail,
  runDatabaseMigrations,
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
}

function bundledMigrations(): BundledMigration[] {
  // Vite inlines the SQL because the built server has no migrations folder. Nitro's own bundle
  // cannot, so the glob runs only when called. https://vite.dev/guide/features#glob-import
  const migrationSources = import.meta.glob<string>("/src/db/migrations/*/migration.{sql,ts}", {
    query: "?raw",
    import: "default",
    eager: true,
  })
  const migrationScripts = import.meta.glob<MigrationModule>("/src/db/migrations/*/migration.ts")
  return Object.entries(migrationSources)
    .filter(([path]) => path.endsWith("/migration.sql"))
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
  Schema.Array(Schema.Struct({ name: Schema.String })),
)

/** Applied history, or `null` before the table or its schema exists. */
const readAppliedMigrationHistory = Effect.fn("readAppliedMigrationHistory")(function* () {
  const result = yield* Effect.tryPromise(() =>
    getAuthDatabase().$client.query(
      "select name from drizzle.__drizzle_migrations where name is not null",
    ),
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

export class DatabaseMigrations extends Context.Service<
  DatabaseMigrations,
  {
    /** Cached until this process applies migrations, which only an operator does. */
    readonly state: Effect.Effect<DatabaseMigrationState>
    /** Applies exactly the pending migrations the operator reviewed, each in its own transaction. */
    readonly apply: (approved: readonly string[]) => Effect.Effect<void, MigrationsNotApplied>
  }
>()("astralbeam/db/DatabaseMigrations") {
  static readonly layer = Layer.effect(
    DatabaseMigrations,
    Effect.gen(function* () {
      const cache = yield* Cache.makeWith(
        () =>
          Effect.map(readAppliedMigrationHistory(), (applied): DatabaseMigrationState => ({
            pending: pendingDatabaseMigrations(bundledMigrations(), applied ?? []),
            appliedCount: applied?.length ?? 0,
          })),
        {
          capacity: 1,
          timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
        },
      )

      const apply = Effect.fn("DatabaseMigrations.apply")(
        function* (approved: readonly string[]) {
          yield* Effect.tryPromise({
            try: () =>
              runDatabaseMigrations(getAuthDatabase().$client, bundledMigrations(), { approved }),
            catch: (cause) => new MigrationsNotApplied({ message: migrationErrorDetail(cause) }),
          }).pipe(
            Effect.tapError(() => Effect.logError("Migration failed")),
            Effect.uninterruptible,
          )
        },
        (effect) => Effect.ensuring(effect, Cache.invalidate(cache, "state")),
      )

      return DatabaseMigrations.of({ state: Cache.get(cache, "state"), apply })
    }),
  )
}
