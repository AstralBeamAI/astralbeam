import {
  fromSpecTokenUsage,
  EventType,
  type ChatMiddleware,
  type StreamChunk,
  type TokenUsage,
} from "@tanstack/ai"
import { Effect, Exit, Stream } from "effect"

import { APP_HANDLE } from "@/lib/constants"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import { modelUsageCost } from "@/lib/model-providers/usage-cost"
import { reportFailure } from "@/lib/runtime/failure-report.server"
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
  async function record(usage: TokenUsage) {
    const spend = options.pricing ? modelUsageCost(options.pricing, usage) : "0"
    const tokens = Math.max(usage.totalTokens, usage.promptTokens + usage.completionTokens)
    await options.execute(
      usageLimits.record({ limits, subject, usage: { tokens, spend } }).pipe(
        // An unrecorded call only undercounts. Ending the reply would lose what was already paid for.
        Effect.catchCause((cause) => reportFailure("chatUsageLimitGuard.record", cause)),
      ),
    )
  }
  async function check() {
    const exit = await options.execute(Effect.exit(usageLimits.check({ limits, subject })))
    if (Exit.isSuccess(exit)) return true
    const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
    if (!failure) return true
    reached = failure.error
    return false
  }
  const middleware: ChatMiddleware = {
    name: "usage-limits",
    onUsage: (_ctx, usage) => record(usage),
    onShouldContinue: check,
  }

  /**
   * Announces the limit on the delivered stream. The engine reports a model call's finish before it
   * consults `onShouldContinue`, and managed delivery holds the run's own finish until the end.
   */
  function announce<E, R>(source: Stream.Stream<StreamChunk, E, R>) {
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
    return Stream.concat(
      source.pipe(
        Stream.flatMap((chunk) =>
          Stream.fromIterable(
            chunk.type === EventType.RUN_FINISHED ? [...notice(), chunk] : [chunk],
          ),
        ),
      ),
      Stream.suspend(() => Stream.fromIterable(notice())),
    )
  }

  return { middleware, announce, record, check }
}

/** Core reports successful-call usage, but usage-bearing failed streams bypass that hook.
 * https://github.com/TanStack/ai/pull/1793 */
export function chatFailedUsageMiddleware(consumers: readonly ChatMiddleware[]): ChatMiddleware {
  let settled = false
  const recordFailure: NonNullable<ChatMiddleware["onModelError"]> = async (ctx, chunk) => {
    if (settled) return
    const usage = Array.isArray(chunk.usage)
      ? fromSpecTokenUsage(chunk.usage, chunk.metadata?.tanstack?.usage)
      : (chunk.usage ?? fromSpecTokenUsage(undefined, chunk.metadata?.tanstack?.usage))
    if (!usage) return
    settled = true
    for (const consumer of consumers) await consumer.onUsage?.(ctx, usage)
  }
  return {
    name: "failed-call-usage",
    onConfig() {
      settled = false
    },
    onUsage() {
      settled = true
    },
    onModelError: recordFailure,
    async onChunk(ctx, chunk) {
      if (chunk.type === EventType.RUN_ERROR) await recordFailure(ctx, chunk)
    },
  }
}
