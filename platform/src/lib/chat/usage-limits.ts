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
export function chatUsageLimitGuard(options: {
  readonly usageLimits: UsageLimits["Service"]
  readonly limits: readonly UsageLimit[]
  readonly subject: UsageSubject
  readonly pricing: ModelConfiguration | null
  readonly execute: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}) {
  const { usageLimits, limits, subject } = options
  let reached: UsageLimitReached | undefined
  const middleware: ChatMiddleware = {
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
  }

  /**
   * Announces the limit on the delivered stream. The engine reports a model call's finish before it
   * consults `onShouldContinue`, and managed delivery holds the run's own finish until the end.
   */
  async function* announce(source: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
    const notice = (): StreamChunk[] => {
      if (!reached) return []
      const event: StreamChunk = {
        type: EventType.CUSTOM,
        name: CHAT_USAGE_LIMIT_REACHED_EVENT,
        value: reached.usageLimit,
      }
      reached = undefined
      return [event]
    }
    for await (const chunk of source) {
      if (chunk.type === EventType.RUN_FINISHED) yield* notice()
      yield chunk
    }
    yield* notice()
  }

  return { middleware, announce }
}
