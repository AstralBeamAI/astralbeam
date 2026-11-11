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
