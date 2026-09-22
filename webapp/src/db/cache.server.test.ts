import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { type EffectDatabase, effectDatabase } from "@/db"
import { deleteDatabaseCache, readDatabaseCache, writeDatabaseCache } from "./cache.server"

it.effect("propagates database failures on reads", () => {
  const cause = new Error("database unavailable")
  const database = {
    select: () => ({ from: () => ({ where: () => Effect.fail(cause) }) }),
    delete: () => ({ where: () => Effect.fail(cause) }),
  } as unknown as EffectDatabase
  return Effect.gen(function* () {
    const error = yield* readDatabaseCache({
      namespace: "database-failure",
      key: "key",
      schema: Schema.String,
    }).pipe(Effect.flip)
    assert.strictEqual(error._tag, "KeyValueStoreError")
    assert.strictEqual(error.cause, cause)
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
  }).pipe(Effect.provideService(effectDatabase, {} as EffectDatabase)))
