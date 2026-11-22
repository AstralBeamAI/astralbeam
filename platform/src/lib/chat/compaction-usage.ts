import type { TokenUsage } from "@tanstack/ai"
import { Schema } from "effect"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

const ChatCompactionNativeUsageSchema = Schema.Struct({
  usage: Schema.Struct({
    input_tokens: Schema.Finite,
    output_tokens: Schema.Finite,
    input_tokens_details: Schema.optional(Schema.Struct({ cached_tokens: Schema.Finite })),
  }),
})

const ChatNativeCompactionIterationsSchema = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    inputTokens: Schema.Finite,
    outputTokens: Schema.Finite,
    cacheCreationInputTokens: Schema.optional(Schema.NullOr(Schema.Finite)),
    cacheReadInputTokens: Schema.optional(Schema.NullOr(Schema.Finite)),
  }),
)

// Preserve per-request cache pricing until TanStack exposes requestUsage for compaction.
// https://github.com/TanStack/ai/pull/2107
export function chatNativeCompactionUsage(usage: TokenUsage): TokenUsage {
  const iterations = usage.providerUsageDetails?.iterations
  if (!Schema.is(ChatNativeCompactionIterationsSchema)(iterations)) return usage
  const requestUsage = iterations
    .filter((iteration) => iteration.type === "compaction")
    .map((iteration) => {
      const cachedTokens = iteration.cacheReadInputTokens ?? 0
      const cacheWriteTokens = iteration.cacheCreationInputTokens ?? 0
      return {
        promptTokens: iteration.inputTokens + cachedTokens + cacheWriteTokens,
        completionTokens: iteration.outputTokens,
        promptTokensDetails: { cachedTokens, cacheWriteTokens },
      }
    })
  if (!requestUsage.length) return usage
  // TanStack can emit nonfinite totals when an iteration omits a cache counter.
  const promptTokens = Number.isFinite(usage.promptTokens)
    ? usage.promptTokens
    : requestUsage.reduce((sum, request) => sum + request.promptTokens, 0)
  return {
    ...usage,
    promptTokens,
    totalTokens: Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : promptTokens + usage.completionTokens,
    providerUsageDetails: { ...usage.providerUsageDetails, requestUsage },
  }
}

// The adapters' compact() returns messages, so observe usage without changing request mapping.
export async function fetchChatCompactionUsage(options: {
  model: ChatModelConfiguration
  input: RequestInfo | URL
  init?: RequestInit | undefined
  record: (usage: TokenUsage) => Promise<void>
}) {
  const { model, input, init } = options
  const url = input instanceof Request ? input.url : String(input)
  const response = await model.fetch(input, init)
  if (new URL(url).pathname.endsWith("/responses/compact")) {
    const result: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)
    if (Schema.is(ChatCompactionNativeUsageSchema)(result)) {
      const usage = result.usage
      await options.record({
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
        promptTokensDetails: { cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0 },
      })
    }
  }
  return response
}
