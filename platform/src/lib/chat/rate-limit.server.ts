import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { CHAT_RATE_LIMIT_MAX_REQUESTS, CHAT_RATE_LIMIT_WINDOW_MS } from "./constants.server"
import { chatPrincipalScope } from "./identity.server"
import type { ChatPrincipal } from "./types"

export function consumeChatRateLimit(principal: ChatPrincipal) {
  return Effect.flatMap(DatabaseRateLimiter, (limiter) =>
    limiter.consume({
      key: `chat:${chatPrincipalScope(principal)}`,
      limit: CHAT_RATE_LIMIT_MAX_REQUESTS,
      window: Duration.millis(CHAT_RATE_LIMIT_WINDOW_MS),
    }),
  )
}
