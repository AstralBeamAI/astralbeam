import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { withDatabaseIdempotency } from "./idempotency.ts"

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
