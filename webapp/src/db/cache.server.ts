import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import { KeyValueStore } from "effect/unstable/persistence"

import { effectDatabase } from "@/db"
import { cacheEntry } from "@/db/schema.server"
import {
  DATABASE_CACHE_KEY_MAX_LENGTH,
  DATABASE_CACHE_NAMESPACE_MAX_LENGTH,
} from "./schema/cache.server"

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

const validateDatabaseCacheKey = Effect.fn("validateDatabaseCacheKey")(function* (options: {
  readonly namespace: string
  readonly key: string
}) {
  if (Array.from(options.namespace).length > DATABASE_CACHE_NAMESPACE_MAX_LENGTH) {
    return yield* Effect.fail(
      new KeyValueStore.KeyValueStoreError({
        method: "validate",
        message:
          `Cache namespace must not exceed ${DATABASE_CACHE_NAMESPACE_MAX_LENGTH} characters`,
      }),
    )
  }
  if (Array.from(options.key).length > DATABASE_CACHE_KEY_MAX_LENGTH) {
    return yield* Effect.fail(
      new KeyValueStore.KeyValueStoreError({
        method: "validate",
        message: `Cache key must not exceed ${DATABASE_CACHE_KEY_MAX_LENGTH} characters`,
      }),
    )
  }
})

const makeDatabaseCacheStore = Effect.fn("makeDatabaseCacheStore")(function* (options: {
  readonly namespace: string
  readonly timeToLive?: Duration.Input
}) {
  const database = yield* effectDatabase
  const namespace = eq(cacheEntry.namespace, options.namespace)
  const live = or(
    isNull(cacheEntry.expiresAt),
    gt(cacheEntry.expiresAt, sql`statement_timestamp()`),
  )
  return KeyValueStore.makeStringOnly({
    get: (key) =>
      database.select({ value: cacheEntry.value }).from(cacheEntry)
        .where(and(namespace, eq(cacheEntry.key, key), live)).pipe(
          Effect.map((rows) => rows[0]?.value),
          Effect.mapError((cause) => databaseCacheError("get", cause)),
        ),
    set: (key, value) =>
      Effect.gen(function* () {
        const milliseconds = yield* Effect.try({
          try: () =>
            options.timeToLive === undefined
              ? Infinity
              : Duration.toMillis(Duration.fromInputUnsafe(options.timeToLive)),
          catch: (cause) => databaseCacheError("set", cause),
        })
        const expiresAt = milliseconds === Infinity
          ? null
          : sql`statement_timestamp() + (${milliseconds} * interval '1 millisecond')`
        yield* database.insert(cacheEntry).values({
          namespace: options.namespace,
          key,
          value,
          expiresAt,
        })
          .onConflictDoUpdate({
            target: [cacheEntry.namespace, cacheEntry.key],
            set: { value, expiresAt, updatedAt: sql`statement_timestamp()` },
          }).pipe(Effect.mapError((cause) => databaseCacheError("set", cause)))
      }),
    remove: (key) =>
      database.delete(cacheEntry).where(and(namespace, eq(cacheEntry.key, key))).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => databaseCacheError("remove", cause)),
      ),
    clear: database.delete(cacheEntry).where(namespace).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => databaseCacheError("clear", cause)),
    ),
    size: database.select({ count: count() }).from(cacheEntry).where(and(namespace, live)).pipe(
      Effect.map((rows) => rows[0]?.count ?? 0),
      Effect.mapError((cause) => databaseCacheError("size", cause)),
    ),
  })
})

export const readDatabaseCache = Effect.fn("readDatabaseCache")(
  function* <S extends Schema.Constraint>(
    options: DatabaseCacheKey & { readonly schema: S },
  ) {
    yield* validateDatabaseCacheKey(options)
    const store = yield* makeDatabaseCacheStore(options)
    return yield* KeyValueStore.toSchemaStore(store, options.schema).get(options.key)
  },
)

// Upserts value and expiry together, preserving id/createdAt and refreshing updatedAt.
// Omitted TTL clears existing expiry. https://www.postgresql.org/docs/18/sql-insert.html#SQL-ON-CONFLICT
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
