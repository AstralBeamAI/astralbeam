import { assert, it } from "@effect/vitest"
import { makeCompiler } from "@effect/sql-pg/PgClient"
import { Effect, Fiber, Queue, Schema } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"

import { IdempotencyInProgress, withDatabaseIdempotency } from "./idempotency.ts"

it.effect("rejects invalid keys and parameters before accessing the database or executing", () =>
  Effect.gen(function* () {
    const operation = {
      name: "example:v1",
      parameters: Schema.Struct({ amount: Schema.Int }),
      success: Schema.String,
      error: Schema.Never,
    }
    for (const input of [
      { key: "", parameters: { amount: 1 } },
      { key: "x".repeat(256), parameters: { amount: 1 } },
      { key: "valid", parameters: { amount: "invalid" } },
      { key: "valid", parameters: { amount: 1, unexpected: true } },
    ]) {
      const error = yield* withDatabaseIdempotency(
        { scope: "organization", operation, ...input },
        () => Effect.die("Must not execute"),
      ).pipe(Effect.flip)
      assert.instanceOf(error, Schema.SchemaError)
    }
  }).pipe(Effect.provideService(SqlClient.SqlClient, {} as SqlClient.SqlClient)),
)

it.effect(
  "rejects a duplicate before pool acquisition and releases admission on interruption",
  () =>
    Effect.gen(function* () {
      const acquired = yield* Queue.unbounded<void>()
      const sql = yield* SqlClient.make({
        driver: "pg",
        compiler: makeCompiler(),
        spanAttributes: [],
        acquirer: Queue.offer(acquired, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.interruptible,
        ),
      }).pipe(Effect.provide(Reactivity.layer))
      const execution = withDatabaseIdempotency(
        {
          scope: "organization",
          key: "waiting-for-pool",
          operation: {
            name: "example:v1",
            parameters: Schema.String,
            success: Schema.String,
            error: Schema.Never,
          },
          parameters: "value",
        },
        () => Effect.die("Must not execute before acquiring a connection"),
      ).pipe(Effect.provideService(SqlClient.SqlClient, sql))
      const first = yield* Effect.forkChild(execution)
      yield* Queue.take(acquired)
      assert.instanceOf(yield* Effect.flip(execution), IdempotencyInProgress)
      yield* Fiber.interrupt(first)
      const next = yield* Effect.forkChild(execution)
      yield* Queue.take(acquired)
      yield* Fiber.interrupt(next)
    }),
)
