import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"

import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { isMissingTableError } from "@/db/lib/postgres-errors.server"

const OPERATOR_LOGIN_RATE_LIMIT_KEY = "configure:operator-login"
const OPERATOR_LOGIN_WINDOW = Duration.minutes(1)
const OPERATOR_LOGIN_MAX_ATTEMPTS = 5

interface OperatorLoginRateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
}

function isRateLimitExceeded(error: RateLimiter.RateLimiterError): boolean {
  return error.reason._tag === "RateLimitExceeded"
}

function isMissingRateLimitTable(error: RateLimiter.RateLimiterError): boolean {
  return error.reason._tag === "RateLimitStoreError" && isMissingTableError(error.reason.cause)
}

function operatorLoginDecision(
  allowed: boolean,
  resetAfter: Duration.Duration,
): OperatorLoginRateLimitDecision {
  return {
    allowed,
    retryAfterSeconds: Math.max(1, Math.ceil(Duration.toMillis(resetAfter) / 1_000)),
  }
}

export function consumeOperatorLoginRateLimit() {
  return databaseRateLimiter.consume({
    key: OPERATOR_LOGIN_RATE_LIMIT_KEY,
    limit: OPERATOR_LOGIN_MAX_ATTEMPTS,
    window: OPERATOR_LOGIN_WINDOW,
  }).pipe(
    Effect.map((result) => operatorLoginDecision(true, result.resetAfter)),
    Effect.catchIf(
      isRateLimitExceeded,
      (error) =>
        Effect.succeed(operatorLoginDecision(
          false,
          error.reason._tag === "RateLimitExceeded" ? error.reason.retryAfter : Duration.zero,
        )),
    ),
    Effect.catchIf(
      isMissingRateLimitTable,
      () => Effect.succeed({ allowed: true, retryAfterSeconds: 0 }),
    ),
  )
}

export function clearOperatorLoginRateLimit() {
  return databaseRateLimiter.reset(OPERATOR_LOGIN_RATE_LIMIT_KEY).pipe(
    Effect.catchIf(isMissingRateLimitTable, () => Effect.succeed(undefined)),
  )
}
