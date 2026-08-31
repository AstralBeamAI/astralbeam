import { eq, sql } from "drizzle-orm"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"

import { type EffectDatabase, effectDatabase } from "@/db/effect.server"
import { rateLimit } from "@/db/schema.server"

const POSTGRES_INTEGER_MAX = 2_147_483_647
const DATABASE_RATE_LIMIT_KEY_PREFIX = "effect-rate-limit:"

interface RateLimitConsumeOptions {
  readonly key: string
  readonly limit: number
  readonly tokens?: number
  readonly window: Duration.Input
}

interface DatabaseRateLimiter {
  readonly consume: (
    options: RateLimitConsumeOptions,
  ) => Effect.Effect<
    RateLimiter.ConsumeResult,
    RateLimiter.RateLimiterError,
    EffectDatabase
  >
  readonly reset: (
    key: string,
  ) => Effect.Effect<void, RateLimiter.RateLimiterError, EffectDatabase>
}

interface ValidatedOptions {
  readonly key: string
  readonly limit: number
  readonly tokens: number
  readonly windowMilliseconds: number
}

function storeError(message: string, cause?: unknown): RateLimiter.RateLimiterError {
  const reason = cause === undefined
    ? new RateLimiter.RateLimitStoreError({ message })
    : new RateLimiter.RateLimitStoreError({ message, cause })
  return new RateLimiter.RateLimiterError({ reason })
}

function validateOptions(
  options: RateLimitConsumeOptions,
): Effect.Effect<ValidatedOptions, RateLimiter.RateLimiterError> {
  return Effect.try({
    try: () => {
      const tokens = options.tokens ?? 1
      const window = Duration.fromInputUnsafe(options.window)
      const windowMilliseconds = Math.ceil(Duration.toMillis(window))
      if (options.key.length === 0) throw new Error("key must not be empty")
      if (
        !Number.isSafeInteger(options.limit) || options.limit <= 0 ||
        options.limit >= POSTGRES_INTEGER_MAX
      ) {
        throw new Error(
          "limit must be a positive safe integer below the PostgreSQL integer maximum",
        )
      }
      if (!Number.isSafeInteger(windowMilliseconds) || windowMilliseconds <= 0) {
        throw new Error("window must resolve to a positive safe number of milliseconds")
      }
      if (!Number.isSafeInteger(tokens) || tokens <= 0 || tokens > POSTGRES_INTEGER_MAX) {
        throw new Error(
          "tokens must be a positive safe integer within the PostgreSQL integer range",
        )
      }
      return {
        key: options.key,
        limit: options.limit,
        tokens,
        windowMilliseconds,
      }
    },
    catch: (cause) => storeError("Invalid rate-limit options", cause),
  })
}

function exceededError(
  options: ValidatedOptions,
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
): Effect.Effect<
  RateLimiter.ConsumeResult,
  RateLimiter.RateLimiterError,
  EffectDatabase
> {
  return Effect.gen(function* () {
    const validated = yield* validateOptions(options)
    const db = yield* effectDatabase
    const persistedKey = `${DATABASE_RATE_LIMIT_KEY_PREFIX}${validated.key}`
    const maximumCount = validated.limit + 1
    const insertedCount = Math.min(validated.tokens, maximumCount)
    const now = sql<number>`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`
      .mapWith(Number)
    const windowExpiresAt = sql<number>`${now} + ${validated.windowMilliseconds}`
    const rows = yield* db
      .insert(rateLimit)
      .values({
        key: persistedKey,
        count: insertedCount,
        // Better Auth shares and prunes this table using lastRequest. Namespaced keys and an
        // expiry timestamp prevent collisions and premature deletion of active custom windows.
        // https://better-auth.com/docs/concepts/rate-limit
        lastRequest: windowExpiresAt,
      })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql<
            number
          >`case when ${rateLimit.lastRequest} <= ${now} then ${insertedCount} else least(${rateLimit.count}::bigint + ${validated.tokens}, ${maximumCount})::integer end`,
          lastRequest: sql<
            number
          >`case when ${rateLimit.lastRequest} <= ${now} then ${windowExpiresAt} else ${rateLimit.lastRequest} end`,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        count: rateLimit.count,
        currentTime: now,
        windowExpiresAt: rateLimit.lastRequest,
      })
      .pipe(
        Effect.mapError((cause) => storeError("Rate-limit database operation failed", cause)),
      )
    const row = rows[0]
    if (!row) return yield* Effect.fail(storeError("Rate-limit update returned no row"))

    const resetAfter = Duration.millis(Math.max(
      0,
      row.windowExpiresAt - row.currentTime,
    ))
    const remaining = validated.limit - row.count
    if (remaining < 0) {
      return yield* Effect.fail(exceededError(validated, resetAfter))
    }
    return {
      delay: Duration.zero,
      limit: validated.limit,
      remaining,
      resetAfter,
    }
  })
}

function reset(
  key: string,
): Effect.Effect<void, RateLimiter.RateLimiterError, EffectDatabase> {
  if (key.length === 0) return Effect.fail(storeError("Rate-limit key must not be empty"))
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    yield* db
      .delete(rateLimit)
      .where(eq(rateLimit.key, `${DATABASE_RATE_LIMIT_KEY_PREFIX}${key}`))
      .pipe(
        Effect.mapError((cause) => storeError("Rate-limit database operation failed", cause)),
      )
  })
}

export const databaseRateLimiter: DatabaseRateLimiter = { consume, reset }
