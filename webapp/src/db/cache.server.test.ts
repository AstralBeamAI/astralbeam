import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

import { SqlClient } from "effect/unstable/sql"
import { deleteDatabaseCache, readDatabaseCache, writeDatabaseCache } from "./cache.server"

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
  }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)))
