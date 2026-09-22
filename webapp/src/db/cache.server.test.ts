import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { KeyValueStore } from "effect/unstable/persistence"
import { SqlClient } from "effect/unstable/sql"
import {
  deleteDatabaseCache,
  readDatabaseCache,
  withDatabaseCacheLock,
  writeDatabaseCache,
} from "./cache.server"

it.effect("rejects oversized and malformed cache identities before accessing the database", () =>
  Effect.gen(function* () {
    for (
      const identity of [
        { namespace: "x".repeat(65), key: "key" },
        { namespace: "valid", key: "😀".repeat(513) },
        { namespace: "\uD800", key: "key" },
        { namespace: "\uDC00", key: "key" },
        { namespace: "valid", key: "\uD800" },
        { namespace: "valid", key: "\uDC00" },
      ]
    ) {
      const options = { ...identity, schema: Schema.String, value: "value" }
      const readError = yield* readDatabaseCache(options).pipe(Effect.flip)
      const writeError = yield* writeDatabaseCache(options).pipe(Effect.flip)
      const deleteError = yield* deleteDatabaseCache(options).pipe(Effect.flip)
      const lockError = yield* withDatabaseCacheLock(options, Effect.die("Must not run")).pipe(
        Effect.flip,
      )
      for (const error of [readError, writeError, deleteError, lockError]) {
        assert.strictEqual(error._tag, "KeyValueStoreError")
      }
    }
  }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)))

it.effect("rejects invalid TTL before accessing the database without double-wrapping the error", () =>
  Effect.gen(function* () {
    const error = yield* writeDatabaseCache({
      namespace: "valid",
      key: "key",
      schema: Schema.String,
      value: "value",
      timeToLive: "1e3 seconds",
    }).pipe(Effect.flip)
    assert.instanceOf(error, KeyValueStore.KeyValueStoreError)
    assert.instanceOf(error.cause, Error)
    assert.notInstanceOf(error.cause, KeyValueStore.KeyValueStoreError)
  }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)))
