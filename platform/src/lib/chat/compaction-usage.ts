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
    cacheCreationInputTokens: Schema.Finite,
    cacheReadInputTokens: Schema.Finite,
  }),
)

// Preserve per-request cache pricing until TanStack exposes requestUsage for compaction.
// https://github.com/TanStack/ai/pull/2107
export function chatNativeCompactionUsage(usage: TokenUsage): TokenUsage {
  const iterations = usage.providerUsageDetails?.iterations
  if (!Schema.is(ChatNativeCompactionIterationsSchema)(iterations)) return usage
  const requestUsage = iterations
    .filter((iteration) => iteration.type === "compaction")
    .map((iteration) => ({
      promptTokens:
        iteration.inputTokens + iteration.cacheReadInputTokens + iteration.cacheCreationInputTokens,
      completionTokens: iteration.outputTokens,
      promptTokensDetails: {
        cachedTokens: iteration.cacheReadInputTokens,
        cacheWriteTokens: iteration.cacheCreationInputTokens,
      },
    }))
  return requestUsage.length
    ? { ...usage, providerUsageDetails: { ...usage.providerUsageDetails, requestUsage } }
    : usage
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
