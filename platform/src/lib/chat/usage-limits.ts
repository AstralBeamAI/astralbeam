import { EventType, type ChatMiddleware, type StreamChunk } from "@tanstack/ai"
import { Effect, Exit } from "effect"

import { APP_HANDLE } from "@/lib/constants"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import { modelUsageCost } from "@/lib/model-providers/usage-cost"
import type { UsageSubject } from "@/lib/usage-limits/counters"
import type { UsageLimitReached } from "@/lib/usage-limits/errors"
import type { UsageLimit, UsageLimits } from "@/lib/usage-limits/usage-limits.server"

/** Tells the client which limit ended a run between model calls, and when it resets. */
const CHAT_USAGE_LIMIT_REACHED_EVENT = `${APP_HANDLE}.usage_limit.reached`

/**
 * Counts each model call against the run's usage limits, and ends the agent loop before another
 * call once any limit is used up. Calls already in flight can finish past a limit.
 */
export function chatUsageLimitMiddleware(options: {
  readonly usageLimits: UsageLimits["Service"]
  readonly limits: readonly UsageLimit[]
  readonly subject: UsageSubject
  readonly pricing: ModelConfiguration | null
  readonly execute: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}): ChatMiddleware {
  const { usageLimits, limits, subject } = options
  let reached: UsageLimitReached | undefined
  let announced = false
  return {
    name: "usage-limits",
    async onUsage(_ctx, usage) {
      const spend = options.pricing ? modelUsageCost(options.pricing, usage) : "0"
      const tokens = Math.max(usage.totalTokens, usage.promptTokens + usage.completionTokens)
      await options.execute(
        usageLimits.record({ limits, subject, usage: { tokens, spend } }).pipe(
          // An unrecorded call only undercounts. Ending the reply would lose what was already paid for.
          Effect.catchCause((cause) => Effect.logError("Usage could not be recorded", cause)),
        ),
      )
    },
    async onShouldContinue() {
      const exit = await options.execute(Effect.exit(usageLimits.check({ limits, subject })))
      if (Exit.isSuccess(exit)) return true
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
      if (!failure) return true
      reached = failure.error
      return false
    },
    onChunk(_ctx, chunk) {
      if (!reached || announced || chunk.type !== EventType.RUN_FINISHED) return
      announced = true
      const event: StreamChunk = {
        type: EventType.CUSTOM,
        name: CHAT_USAGE_LIMIT_REACHED_EVENT,
        value: reached.usageLimit,
      }
      return [event, chunk]
    },
  }
}
