import { assert, describe, it } from "@effect/vitest"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { RateLimiter } from "effect/unstable/persistence"
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError"

import { type EffectDatabase, effectDatabase } from "@/db/effect.server"

import { consumeOperatorLoginRateLimit } from "./login-rate-limit.server.ts"

describe("operator login rate limiting", () => {
  it.effect("fails open only while the rate-limit table is missing", () => {
    const missingTable = queryError("42P01")
    const unavailable = queryError("08006")

    return Effect.gen(function* () {
      const bootstrapDecision = yield* consumeOperatorLoginRateLimit().pipe(
        Effect.provide(Layer.succeed(effectDatabase, failingDatabase(missingTable))),
      )
      assert.deepStrictEqual(bootstrapDecision, { allowed: true, retryAfterSeconds: 0 })

      const error = yield* consumeOperatorLoginRateLimit().pipe(
        Effect.provide(Layer.succeed(effectDatabase, failingDatabase(unavailable))),
        Effect.flip,
      )
      assert.instanceOf(error.reason, RateLimiter.RateLimitStoreError)
      assert.strictEqual(error.reason.cause, unavailable)
    })
  })
})

function queryError(code: string): EffectDrizzleQueryError {
  const driverError = Object.assign(new Error("database query failed"), { code })
  const sqlError = new SqlError({
    reason: new UnknownError({ cause: driverError, operation: "execute" }),
  })
  return new EffectDrizzleQueryError({
    cause: Cause.fail(sqlError),
    params: [],
    query: "insert into rate_limit",
  })
}

function failingDatabase(cause: unknown): EffectDatabase {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Effect.fail(cause),
        }),
      }),
    }),
  } as unknown as EffectDatabase
}
