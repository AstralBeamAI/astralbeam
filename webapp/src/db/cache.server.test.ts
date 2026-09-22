import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { type EffectDatabase, effectDatabase } from "@/db"
import {
  deleteDatabaseCache,
  makeDatabaseCacheLookup,
  readDatabaseCache,
  writeDatabaseCache,
} from "./cache.server"

it.effect("propagates database failures without running the loader", () => {
  const cause = new Error("database unavailable")
  const database = {
    select: () => ({ from: () => ({ where: () => Effect.fail(cause) }) }),
    delete: () => ({ where: () => Effect.fail(cause) }),
  } as unknown as EffectDatabase
  return Effect.gen(function* () {
    let calls = 0
    const lookup = yield* makeDatabaseCacheLookup({
      namespace: "database-failure",
      schema: Schema.String,
      lookup: () =>
        Effect.sync(() => {
          calls++
          return "value"
        }),
    })
    const error = yield* lookup("key").pipe(Effect.flip)
    assert.strictEqual(error._tag, "KeyValueStoreError")
    assert.strictEqual(error.cause, cause)
    assert.strictEqual(calls, 0)
  }).pipe(Effect.provideService(effectDatabase, database))
})

it.effect("propagates write failures", () => {
  const cause = new Error("write unavailable")
  const database = {
    select: () => ({ from: () => ({ where: () => Effect.succeed([]) }) }),
    delete: () => ({ where: () => Effect.succeed([]) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Effect.fail(cause) }) }),
  } as unknown as EffectDatabase
  return Effect.gen(function* () {
    const error = yield* writeDatabaseCache({
      namespace: "write-failure",
      key: "key",
      schema: Schema.String,
      value: "value",
    }).pipe(Effect.flip)
    assert.strictEqual(error._tag, "KeyValueStoreError")
    assert.strictEqual(error.cause, cause)
  }).pipe(Effect.provideService(effectDatabase, database))
})

it.effect("retries synchronously interrupted loads", () => {
  const database = {
    select: () => ({ from: () => ({ where: () => Effect.succeed([]) }) }),
    delete: () => ({ where: () => Effect.succeed([]) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Effect.void }) }),
  } as unknown as EffectDatabase
  return Effect.gen(function* () {
    let calls = 0
    const lookup = yield* makeDatabaseCacheLookup({
      namespace: "interrupted",
      schema: Schema.String,
      lookup: () =>
        Effect.suspend(() => ++calls > 1 ? Effect.succeed("retried") : Effect.interrupt),
    })
    const invalid = yield* lookup("x".repeat(513)).pipe(Effect.flip)
    assert.strictEqual(invalid._tag, "KeyValueStoreError")
    assert.strictEqual(calls, 0)
    yield* Effect.exit(lookup("key"))
    assert.strictEqual(yield* lookup("key"), "retried")
    assert.strictEqual(calls, 2)
  }).pipe(Effect.provideService(effectDatabase, database))
})

it.effect("rejects oversized cache identities before accessing the database", () =>
  Effect.gen(function* () {
    for (
      const identity of [
        { namespace: "x".repeat(65), key: "key" },
        { namespace: "valid", key: "😀".repeat(513) },
      ]
    ) {
      const options = { ...identity, schema: Schema.String, value: "value" }
      const readError = yield* readDatabaseCache(options).pipe(Effect.flip)
      const writeError = yield* writeDatabaseCache(options).pipe(Effect.flip)
      const deleteError = yield* deleteDatabaseCache(options).pipe(Effect.flip)
      for (const error of [readError, writeError, deleteError]) {
        assert.strictEqual(error._tag, "KeyValueStoreError")
      }
    }
    const error = yield* makeDatabaseCacheLookup({
      namespace: "x".repeat(65),
      schema: Schema.String,
      lookup: () => Effect.succeed("value"),
    }).pipe(Effect.flip)
    assert.strictEqual(error._tag, "KeyValueStoreError")
  }).pipe(Effect.provideService(effectDatabase, {} as EffectDatabase)))
