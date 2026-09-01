import { createHash } from "node:crypto"

import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { RateLimiter } from "effect/unstable/persistence"

import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { CHAT_RATE_LIMIT_MAX_REQUESTS, CHAT_RATE_LIMIT_WINDOW_MS } from "./constants.server"
import type { ChatPrincipal } from "./types"

export function consumeChatRateLimit(principal: ChatPrincipal) {
  const identity = createHash("sha256")
    .update(principal.organization.id)
    .update("\0")
    .update(principal.tenantUser.id)
    .digest("base64url")

  return databaseRateLimiter.consume({
    key: `chat:${identity}`,
    limit: CHAT_RATE_LIMIT_MAX_REQUESTS,
    window: Duration.millis(CHAT_RATE_LIMIT_WINDOW_MS),
  }).pipe(
    Effect.as(false),
    Effect.catchIf(
      (error: RateLimiter.RateLimiterError) => error.reason._tag === "RateLimitExceeded",
      () => Effect.succeed(true),
    ),
  )
}
