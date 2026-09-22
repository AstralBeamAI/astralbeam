import { Duration, Effect, Schema } from "effect"
import { KeyValueStore } from "effect/unstable/persistence"
import { SqlClient } from "effect/unstable/sql"
import {
  DATABASE_CACHE_KEY_MAX_LENGTH,
  DATABASE_CACHE_NAMESPACE_MAX_LENGTH,
} from "./schema/cache.server.ts"

interface DatabaseCacheKey {
  readonly namespace: string
  readonly key: string
}

function databaseCacheError(method: string, cause: unknown) {
  return new KeyValueStore.KeyValueStoreError({
    method,
    message: "Cache database operation failed",
    cause,
  })
}

const validateDatabaseCacheKey = Effect.fn("validateDatabaseCacheKey")(
  function* (options: DatabaseCacheKey) {
    if (
      Array.from(options.namespace).length > DATABASE_CACHE_NAMESPACE_MAX_LENGTH ||
      Array.from(options.key).length > DATABASE_CACHE_KEY_MAX_LENGTH
    ) {
      return yield* Effect.fail(
        databaseCacheError("validate", "Cache identity exceeds length limit"),
      )
    }
  },
)

// Transaction locks cover absent keys and work with transaction pooling, unlike session locks.
// https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS
export function withDatabaseCacheLock<A, E, R>(
  options: DatabaseCacheKey,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* validateDatabaseCacheKey(options)
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`select pg_advisory_xact_lock(hashtextextended(${
        JSON.stringify(["cache", options.namespace, options.key])
      }, 0))`
      return yield* effect
    }))
  })
}

const makeDatabaseCacheStore = Effect.fn("makeDatabaseCacheStore")(function* (options: {
  readonly namespace: string
  readonly timeToLive?: Duration.Input
}) {
  const sql = yield* SqlClient.SqlClient
  return KeyValueStore.makeStringOnly({
    get: (key) =>
      sql<{ value: string }>`select value from cache_entry
      where namespace = ${options.namespace} and key = ${key}
      and (expires_at is null or expires_at > statement_timestamp())`.pipe(
        Effect.map((rows) => rows[0]?.value),
        Effect.mapError((cause) => databaseCacheError("get", cause)),
      ),
    set: (key, value) =>
      withDatabaseCacheLock(
        { namespace: options.namespace, key },
        Effect.gen(function* () {
          const milliseconds = yield* Effect.try({
            try: () =>
              options.timeToLive === undefined
                ? Infinity
                : Duration.toMillis(Duration.fromInputUnsafe(options.timeToLive)),
            catch: (cause) => databaseCacheError("set", cause),
          })
          yield* sql`insert into cache_entry (namespace, key, value, expires_at)
        values (${options.namespace}, ${key}, ${value},
          statement_timestamp() + (${
            milliseconds === Infinity ? null : milliseconds
          }::double precision * interval '1 millisecond'))
        on conflict (namespace, key) do update set value = excluded.value,
          expires_at = excluded.expires_at, updated_at = statement_timestamp()`
        }),
      ).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError((cause) => databaseCacheError("set", cause)),
      ),
    remove: (key) =>
      withDatabaseCacheLock(
        { namespace: options.namespace, key },
        sql`delete from cache_entry where namespace = ${options.namespace} and key = ${key}`,
      ).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.asVoid,
        Effect.mapError((cause) => databaseCacheError("remove", cause)),
      ),
    clear: sql`delete from cache_entry where namespace = ${options.namespace}`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => databaseCacheError("clear", cause)),
    ),
    size: sql<{ count: number }>`select count(*)::integer as count from cache_entry
      where namespace = ${options.namespace} and (expires_at is null or expires_at > statement_timestamp())`
      .pipe(
        Effect.map((rows) => rows[0]!.count),
        Effect.mapError((cause) => databaseCacheError("size", cause)),
      ),
  })
})

export const readDatabaseCache = Effect.fn("readDatabaseCache")(
  function* <S extends Schema.Constraint>(options: DatabaseCacheKey & { readonly schema: S }) {
    yield* validateDatabaseCacheKey(options)
    const store = yield* makeDatabaseCacheStore(options)
    return yield* KeyValueStore.toSchemaStore(store, options.schema).get(options.key)
  },
)

// Upserts value and expiry together. Omitted TTL clears existing expiry.
// https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
export const writeDatabaseCache = Effect.fn("writeDatabaseCache")(
  function* <S extends Schema.Constraint>(
    options: DatabaseCacheKey & {
      readonly schema: S
      readonly value: S["Type"]
      readonly timeToLive?: Duration.Input
    },
  ) {
    yield* validateDatabaseCacheKey(options)
    const store = yield* makeDatabaseCacheStore(options)
    yield* KeyValueStore.toSchemaStore(store, options.schema).set(options.key, options.value)
  },
)

export const deleteDatabaseCache = Effect.fn("deleteDatabaseCache")(
  function* (options: DatabaseCacheKey) {
    yield* validateDatabaseCacheKey(options)
    const store = yield* makeDatabaseCacheStore(options)
    yield* store.remove(options.key)
  },
)
