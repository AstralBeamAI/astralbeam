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

const validateDatabaseCacheKey = Effect.fn("validateDatabaseCacheKey")(function* (
  options: DatabaseCacheKey,
) {
  // UTF-8 replaces lone surrogates, which would make stored keys disagree with JSON lock identities.
  // https://encoding.spec.whatwg.org/#interface-textencoder
  if (!options.namespace.isWellFormed() || !options.key.isWellFormed()) {
    return yield* Effect.fail(
      databaseCacheError("validate", "Cache namespace and key must be well-formed Unicode"),
    )
  }
  if (
    Array.from(options.namespace).length > DATABASE_CACHE_NAMESPACE_MAX_LENGTH ||
    Array.from(options.key).length > DATABASE_CACHE_KEY_MAX_LENGTH
  ) {
    return yield* Effect.fail(databaseCacheError("validate", "Cache identity exceeds length limit"))
  }
})

// Transaction locks cover absent keys and work with transaction pooling, unlike session locks.
// https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS
function withValidatedDatabaseCacheLock<A, E, R>(
  sql: SqlClient.SqlClient,
  options: DatabaseCacheKey,
  effect: Effect.Effect<A, E, R>,
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        "cache",
        options.namespace,
        options.key,
      ])}, 0))`
      return yield* effect
    }),
  )
}

export function withDatabaseCacheLock<A, E, R>(
  options: DatabaseCacheKey,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* validateDatabaseCacheKey(options)
    const sql = yield* SqlClient.SqlClient
    return yield* withValidatedDatabaseCacheLock(sql, options, effect)
  })
}

const makeDatabaseCacheStore = Effect.fn("makeDatabaseCacheStore")(function* (options: {
  readonly namespace: string
  readonly timeToLiveMillis?: number
}) {
  const sql = yield* SqlClient.SqlClient
  const milliseconds = options.timeToLiveMillis ?? Infinity
  return KeyValueStore.makeStringOnly({
    get: (key) =>
      sql<{ value: string }>`select value from cache_entry
      where namespace = ${options.namespace} and key = ${key}
      and (expires_at is null or expires_at > statement_timestamp())`.pipe(
        Effect.map((rows) => rows[0]?.value),
        Effect.mapError((cause) => databaseCacheError("get", cause)),
      ),
    set: (key, value) =>
      withValidatedDatabaseCacheLock(
        sql,
        { namespace: options.namespace, key },
        sql`insert into cache_entry (namespace, key, value, expires_at)
        values (${options.namespace}, ${key}, ${value},
          statement_timestamp() + (${
            milliseconds === Infinity ? null : milliseconds
          }::double precision * interval '1 millisecond'))
        on conflict (namespace, key) do update set value = excluded.value,
          expires_at = excluded.expires_at, updated_at = statement_timestamp()`,
      ).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => databaseCacheError("set", cause)),
      ),
    remove: (key) =>
      withValidatedDatabaseCacheLock(
        sql,
        { namespace: options.namespace, key },
        sql`delete from cache_entry where namespace = ${options.namespace} and key = ${key}`,
      ).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => databaseCacheError("remove", cause)),
      ),
    clear: sql`delete from cache_entry where namespace = ${options.namespace}`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => databaseCacheError("clear", cause)),
    ),
    size: sql<{ count: number }>`select count(*)::integer as count from cache_entry
      where namespace = ${options.namespace} and (expires_at is null or expires_at > statement_timestamp())`.pipe(
      Effect.map((rows) => rows[0]!.count),
      Effect.mapError((cause) => databaseCacheError("size", cause)),
    ),
  })
})

export const readDatabaseCache = Effect.fn("readDatabaseCache")(function* <
  S extends Schema.Constraint,
>(options: DatabaseCacheKey & { readonly schema: S }) {
  yield* validateDatabaseCacheKey(options)
  const store = yield* makeDatabaseCacheStore(options)
  return yield* KeyValueStore.toSchemaStore(store, options.schema).get(options.key)
})

// Upserts value and expiry together. Omitted TTL clears existing expiry.
// https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
export const writeDatabaseCache = Effect.fn("writeDatabaseCache")(function* <
  S extends Schema.Constraint,
>(
  options: DatabaseCacheKey & {
    readonly schema: S
    readonly value: S["Type"]
    readonly timeToLive?: Duration.Input
  },
) {
  yield* validateDatabaseCacheKey(options)
  const timeToLiveMillis = yield* Effect.try({
    try: () =>
      options.timeToLive === undefined ? Infinity : Duration.toMillis(options.timeToLive),
    catch: (cause) => databaseCacheError("set", cause),
  })
  const store = yield* makeDatabaseCacheStore({ namespace: options.namespace, timeToLiveMillis })
  yield* KeyValueStore.toSchemaStore(store, options.schema).set(options.key, options.value)
})

export const deleteDatabaseCache = Effect.fn("deleteDatabaseCache")(function* (
  options: DatabaseCacheKey,
) {
  yield* validateDatabaseCacheKey(options)
  const store = yield* makeDatabaseCacheStore(options)
  yield* store.remove(options.key)
})

export const deleteExpiredDatabaseCacheBatch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const deleted = yield* sql<{ id: string }>`delete from cache_entry where id in (
    select id from cache_entry
    where expires_at <= statement_timestamp()
    order by expires_at, id
    limit 1000
    for update skip locked
  ) returning id`
  return deleted.length
})
