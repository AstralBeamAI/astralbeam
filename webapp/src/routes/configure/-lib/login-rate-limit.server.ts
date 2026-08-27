import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"

import { isMissingTableError } from "@/db/lib/postgres-errors.server"
import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"

const OPERATOR_LOGIN_RATE_LIMIT_KEY = "configure:operator-login"
const OPERATOR_LOGIN_WINDOW = Duration.minutes(1)
const OPERATOR_LOGIN_MAX_ATTEMPTS = 5

interface OperatorLoginRateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
}

let bootstrapAttemptCount = 0
let bootstrapWindowStartedAt = 0

function consumeBootstrapOperatorLoginRateLimit(
  now: number,
): OperatorLoginRateLimitDecision {
  const windowMilliseconds = Duration.toMillis(OPERATOR_LOGIN_WINDOW)
  if (bootstrapWindowStartedAt + windowMilliseconds <= now) {
    bootstrapAttemptCount = 0
    bootstrapWindowStartedAt = now
  }
  bootstrapAttemptCount += 1
  const resetAfter = Duration.millis(Math.max(
    0,
    bootstrapWindowStartedAt + windowMilliseconds - now,
  ))
  const remaining = OPERATOR_LOGIN_MAX_ATTEMPTS - bootstrapAttemptCount
  return operatorLoginDecision(remaining >= 0, resetAfter)
}

function isMissingRateLimitTable(error: RateLimiter.RateLimiterError): boolean {
  return error.reason._tag === "RateLimitStoreError" &&
    isMissingTableError(error.reason.cause)
}

function isRateLimitExceeded(error: RateLimiter.RateLimiterError): boolean {
  return error.reason._tag === "RateLimitExceeded"
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
      isMissingRateLimitTable,
      () => Effect.sync(() => consumeBootstrapOperatorLoginRateLimit(Date.now())),
    ),
    Effect.catchIf(
      isRateLimitExceeded,
      (error) =>
        Effect.succeed(operatorLoginDecision(
          false,
          error.reason._tag === "RateLimitExceeded" ? error.reason.retryAfter : Duration.zero,
        )),
    ),
  )
}

export function clearOperatorLoginRateLimit() {
  bootstrapAttemptCount = 0
  bootstrapWindowStartedAt = 0
  return databaseRateLimiter.reset(OPERATOR_LOGIN_RATE_LIMIT_KEY).pipe(
    Effect.catchIf(isMissingRateLimitTable, () => Effect.void),
  )
}
