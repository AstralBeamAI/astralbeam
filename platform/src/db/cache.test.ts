import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { KeyValueStore } from "effect/persistence"
import { SqlClient } from "effect/sql"
import { makeDatabaseCache, tryWithDatabaseCacheLock, withDatabaseCacheLock } from "./cache"

it.effect("rejects oversized and malformed cache identities before accessing the database", () =>
  Effect.gen(function* () {
    for (const namespace of ["x".repeat(65), "\uD800", "\uDC00"]) {
      const error = yield* makeDatabaseCache({ namespace, schema: Schema.String }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "KeyValueStoreError")
    }
    const cache = yield* makeDatabaseCache({ namespace: "valid", schema: Schema.String })
    for (const identity of [
      { namespace: "x".repeat(65), key: "key" },
      { namespace: "valid", key: "😀".repeat(513) },
      { namespace: "valid", key: "\uD800" },
      { namespace: "valid", key: "\uDC00" },
    ]) {
      const errors = [
        yield* withDatabaseCacheLock(identity, Effect.die("Must not run")).pipe(Effect.flip),
        yield* tryWithDatabaseCacheLock(identity, Effect.die("Must not run")).pipe(Effect.flip),
        ...(identity.namespace === "valid"
          ? [
              yield* cache.get(identity.key).pipe(Effect.flip),
              yield* cache.set(identity.key, "value").pipe(Effect.flip),
              yield* cache.remove(identity.key).pipe(Effect.flip),
            ]
          : []),
      ]
      for (const error of errors) assert.strictEqual(error._tag, "KeyValueStoreError")
    }
  }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)),
)

it.effect(
  "rejects invalid TTL before accessing the database without double-wrapping the error",
  () =>
    Effect.gen(function* () {
      const error = yield* makeDatabaseCache({
        namespace: "valid",
        schema: Schema.String,
        timeToLive: "1e3 seconds",
      }).pipe(Effect.flip)
      assert.instanceOf(error, KeyValueStore.KeyValueStoreError)
      assert.instanceOf(error.cause, Error)
      assert.notInstanceOf(error.cause, KeyValueStore.KeyValueStoreError)
    }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)),
)
