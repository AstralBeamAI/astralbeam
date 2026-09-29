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

// UTF-8 replaces lone surrogates, which would make stored keys disagree with JSON lock identities.
// https://encoding.spec.whatwg.org/#interface-textencoder
const validateDatabaseCacheIdentity = Effect.fnUntraced(function* (
  method: string,
  value: string,
  maxLength: number,
) {
  if (!value.isWellFormed()) {
    return yield* databaseCacheError(method, "Cache namespace and key must be well-formed Unicode")
  }
  if (Array.from(value).length > maxLength) {
    return yield* databaseCacheError(method, "Cache identity exceeds length limit")
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

export const withDatabaseCacheLock = Effect.fnUntraced(function* <A, E, R>(
  options: DatabaseCacheKey,
  effect: Effect.Effect<A, E, R>,
) {
  yield* validateDatabaseCacheIdentity(
    "lock",
    options.namespace,
    DATABASE_CACHE_NAMESPACE_MAX_LENGTH,
  )
  yield* validateDatabaseCacheIdentity("lock", options.key, DATABASE_CACHE_KEY_MAX_LENGTH)
  const sql = yield* SqlClient.SqlClient
  return yield* withValidatedDatabaseCacheLock(sql, options, effect)
})

// One schema-typed store per namespace. Writes upsert value and expiry together, never expiring
// without `timeToLive`. https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
export const makeDatabaseCache = Effect.fn("makeDatabaseCache")(function* <
  S extends Schema.Constraint,
>(options: {
  readonly namespace: string
  readonly schema: S
  readonly timeToLive?: Duration.Input
}) {
  const { namespace } = options
  yield* validateDatabaseCacheIdentity("make", namespace, DATABASE_CACHE_NAMESPACE_MAX_LENGTH)
  const milliseconds = yield* Effect.try({
    try: () =>
      options.timeToLive === undefined ? Infinity : Duration.toMillis(options.timeToLive),
    catch: (cause) => databaseCacheError("make", cause),
  })
  const expiresAfter = milliseconds === Infinity ? null : milliseconds
  const sql = yield* SqlClient.SqlClient
  const keyed = <A>(method: string, key: string, query: () => Effect.Effect<A, unknown>) =>
    validateDatabaseCacheIdentity(method, key, DATABASE_CACHE_KEY_MAX_LENGTH).pipe(
      Effect.andThen(() =>
        query().pipe(Effect.mapError((cause) => databaseCacheError(method, cause))),
      ),
    )
  const store = KeyValueStore.makeStringOnly({
    get: (key) =>
      keyed("get", key, () =>
        sql<{ value: string }>`select value from cache_entry
        where namespace = ${namespace} and key = ${key}
        and (expires_at is null or expires_at > statement_timestamp())`.pipe(
          Effect.map((rows) => rows[0]?.value),
        ),
      ),
    set: (key, value) =>
      keyed("set", key, () =>
        withValidatedDatabaseCacheLock(
          sql,
          { namespace, key },
          sql`insert into cache_entry (namespace, key, value, expires_at)
          values (${namespace}, ${key}, ${value},
            statement_timestamp() + (${expiresAfter}::double precision * interval '1 millisecond'))
          on conflict (namespace, key) do update set value = excluded.value,
            expires_at = excluded.expires_at, updated_at = statement_timestamp()`,
        ).pipe(Effect.asVoid),
      ),
    remove: (key) =>
      keyed("remove", key, () =>
        withValidatedDatabaseCacheLock(
          sql,
          { namespace, key },
          sql`delete from cache_entry where namespace = ${namespace} and key = ${key}`,
        ).pipe(Effect.asVoid),
      ),
    clear: Effect.suspend(() => sql`delete from cache_entry where namespace = ${namespace}`).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => databaseCacheError("clear", cause)),
    ),
    size: Effect.suspend(
      () => sql<{ count: number }>`select count(*)::integer as count from cache_entry
      where namespace = ${namespace} and (expires_at is null or expires_at > statement_timestamp())`,
    ).pipe(
      Effect.map((rows) => rows[0]!.count),
      Effect.mapError((cause) => databaseCacheError("size", cause)),
    ),
  })
  return KeyValueStore.toSchemaStore(store, options.schema)
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
