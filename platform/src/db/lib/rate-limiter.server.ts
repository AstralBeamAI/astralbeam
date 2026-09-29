import { createHash } from "node:crypto"

import { eq, sql } from "drizzle-orm"
import { Context, Duration, Effect, Layer } from "effect"
import { RateLimiter } from "effect/unstable/persistence"

import { Database } from "@/db/database.server"
import { rateLimit } from "@/db/schema.server"

const DATABASE_RATE_LIMIT_KEY_PREFIX = "effect-rate-limit:"

interface RateLimitConsumeOptions {
  readonly key: string
  readonly limit: number
  readonly window: Duration.Input
}

/** A bucket key that names its namespace without storing the identity it counts. */
export function hashedRateLimitKey(namespace: string, identity: readonly string[]): string {
  return `${namespace}:${createHash("sha256").update(JSON.stringify(identity)).digest("base64url")}`
}

/** Whole seconds until a limited caller may retry, never zero, for a `Retry-After` header. */
export function rateLimitRetryAfterSeconds(retryAfter: Duration.Input): number {
  return Math.max(1, Math.ceil(Duration.toMillis(retryAfter) / 1_000))
}

function storeError(cause?: unknown): RateLimiter.RateLimiterError {
  const message = "Rate-limit database operation failed"
  const reason =
    cause === undefined
      ? new RateLimiter.RateLimitStoreError({ message })
      : new RateLimiter.RateLimitStoreError({ message, cause })
  return new RateLimiter.RateLimiterError({ reason })
}

// Effect's persistent RateLimiter store extends its window per token, so fixed windows count here.
// https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/unstable/persistence/RateLimiter.ts
export class DatabaseRateLimiter extends Context.Service<
  DatabaseRateLimiter,
  {
    /** Store failures stay typed because `/configure` sign-in degrades when the table is missing. */
    readonly consume: (
      options: RateLimitConsumeOptions,
    ) => Effect.Effect<RateLimiter.ConsumeResult, RateLimiter.RateLimiterError>
    readonly reset: (options: {
      readonly key: string
    }) => Effect.Effect<void, RateLimiter.RateLimiterError>
  }
>()("astralbeam/db/DatabaseRateLimiter") {
  static readonly layerNoDeps = Layer.effect(
    DatabaseRateLimiter,
    Effect.gen(function* () {
      const db = yield* Database

      const consume = Effect.fn("DatabaseRateLimiter.consume")(function* (
        options: RateLimitConsumeOptions,
      ) {
        const windowMilliseconds = Math.ceil(Duration.toMillis(options.window))
        const persistedKey = `${DATABASE_RATE_LIMIT_KEY_PREFIX}${options.key}`
        const maximumCount = options.limit + 1
        const now =
          sql<number>`floor(extract(epoch from statement_timestamp()) * 1000)::bigint`.mapWith(
            Number,
          )
        const windowExpiresAt = sql<number>`${now} + ${windowMilliseconds}`
        const [row] = yield* db
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
          .pipe(Effect.mapError(storeError))
        if (!row) return yield* Effect.fail(storeError())

        const resetAfter = Duration.millis(Math.max(0, row.windowExpiresAt - row.currentTime))
        const remaining = options.limit - row.count
        if (remaining < 0) {
          return yield* new RateLimiter.RateLimiterError({
            reason: new RateLimiter.RateLimitExceeded({
              key: options.key,
              limit: options.limit,
              remaining: 0,
              retryAfter: resetAfter,
            }),
          })
        }
        return { delay: Duration.zero, limit: options.limit, remaining, resetAfter }
      })

      const reset = Effect.fn("DatabaseRateLimiter.reset")(function* (options: {
        readonly key: string
      }) {
        yield* db
          .delete(rateLimit)
          .where(eq(rateLimit.key, `${DATABASE_RATE_LIMIT_KEY_PREFIX}${options.key}`))
          .pipe(Effect.mapError(storeError))
      })

      return DatabaseRateLimiter.of({ consume, reset })
    }),
  )

  static readonly layer = DatabaseRateLimiter.layerNoDeps.pipe(Layer.provide(Database.layer))
}
