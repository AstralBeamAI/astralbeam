import { eq, sql } from "drizzle-orm"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"

import { type EffectDatabase, effectDatabase } from "@/db"
import { rateLimit } from "@/db/schema.server"

const DATABASE_RATE_LIMIT_KEY_PREFIX = "effect-rate-limit:"

interface RateLimitConsumeOptions {
  readonly key: string
  readonly limit: number
  readonly window: Duration.Input
}

interface DatabaseRateLimiter {
  readonly consume: (
    options: RateLimitConsumeOptions,
  ) => Effect.Effect<RateLimiter.ConsumeResult, RateLimiter.RateLimiterError, EffectDatabase>
  readonly reset: (key: string) => Effect.Effect<void, RateLimiter.RateLimiterError, EffectDatabase>
}

function storeError(message: string, cause?: unknown): RateLimiter.RateLimiterError {
  const reason =
    cause === undefined
      ? new RateLimiter.RateLimitStoreError({ message })
      : new RateLimiter.RateLimitStoreError({ message, cause })
  return new RateLimiter.RateLimiterError({ reason })
}

function exceededError(
  options: RateLimitConsumeOptions,
  resetAfter: Duration.Duration,
): RateLimiter.RateLimiterError {
  return new RateLimiter.RateLimiterError({
    reason: new RateLimiter.RateLimitExceeded({
      key: options.key,
      limit: options.limit,
      remaining: 0,
      retryAfter: resetAfter,
    }),
  })
}

// Effect's persistent RateLimiter uses the same consume contract and policy/store split, but has
// no PostgreSQL store. This subset uses Effect's fixed-window, fail-on-exceeded, one-token defaults;
// a future implementation can widen the supported options without changing callers.
// https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/unstable/persistence/RateLimiter.ts
function consume(
  options: RateLimitConsumeOptions,
): Effect.Effect<RateLimiter.ConsumeResult, RateLimiter.RateLimiterError, EffectDatabase> {
  return Effect.gen(function* () {
    const windowMilliseconds = Math.ceil(Duration.toMillis(options.window))
    const db = yield* effectDatabase
    const persistedKey = `${DATABASE_RATE_LIMIT_KEY_PREFIX}${options.key}`
    const maximumCount = options.limit + 1
    const now =
      sql<number>`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`.mapWith(Number)
    const windowExpiresAt = sql<number>`${now} + ${windowMilliseconds}`
    const rows = yield* db
      .insert(rateLimit)
      .values({
        key: persistedKey,
        count: 1,
        // Better Auth shares and prunes this table using lastRequest. Namespaced keys and an
        // expiry timestamp prevent collisions and premature deletion of active custom windows.
        // https://better-auth.com/docs/concepts/rate-limit
        lastRequest: windowExpiresAt,
      })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql<number>`case when ${rateLimit.lastRequest} <= ${now} then 1 else least(${rateLimit.count}::bigint + 1, ${maximumCount})::integer end`,
          lastRequest: sql<number>`case when ${rateLimit.lastRequest} <= ${now} then ${windowExpiresAt} else ${rateLimit.lastRequest} end`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        count: rateLimit.count,
        currentTime: now,
        windowExpiresAt: rateLimit.lastRequest,
      })
      .pipe(Effect.mapError((cause) => storeError("Rate-limit database operation failed", cause)))
    const row = rows[0]
    if (!row) return yield* Effect.fail(storeError("Rate-limit update returned no row"))

    const resetAfter = Duration.millis(Math.max(0, row.windowExpiresAt - row.currentTime))
    const remaining = options.limit - row.count
    if (remaining < 0) {
      return yield* Effect.fail(exceededError(options, resetAfter))
    }
    return {
      delay: Duration.zero,
      limit: options.limit,
      remaining,
      resetAfter,
    }
  })
}

function reset(key: string): Effect.Effect<void, RateLimiter.RateLimiterError, EffectDatabase> {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    yield* db
      .delete(rateLimit)
      .where(eq(rateLimit.key, `${DATABASE_RATE_LIMIT_KEY_PREFIX}${key}`))
      .pipe(Effect.mapError((cause) => storeError("Rate-limit database operation failed", cause)))
  })
}

export const databaseRateLimiter: DatabaseRateLimiter = { consume, reset }
