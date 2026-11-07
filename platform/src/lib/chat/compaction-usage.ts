import type { TokenUsage } from "@tanstack/ai"
import { Schema } from "effect"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

const ChatCompactionNativeUsageSchema = Schema.Struct({
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
    input_tokens_details: Schema.optional(Schema.Struct({ cached_tokens: Schema.Number })),
  }),
})

const AnthropicCompactionTokenUsageSchema = Schema.Struct({
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  cache_read_input_tokens: Schema.optional(Schema.Number),
  cache_creation_input_tokens: Schema.optional(Schema.Number),
  cache_creation: Schema.optional(
    Schema.NullOr(Schema.Struct({ ephemeral_1h_input_tokens: Schema.Number })),
  ),
})
const AnthropicCompactionUsageSchema = Schema.Struct({
  usage: Schema.Struct({
    ...AnthropicCompactionTokenUsageSchema.fields,
    iterations: Schema.optional(Schema.NullOr(Schema.Array(AnthropicCompactionTokenUsageSchema))),
  }),
})
export function chatAnthropicCompactionUsage(value: unknown): TokenUsage | undefined {
  if (!Schema.is(AnthropicCompactionUsageSchema)(value)) return undefined
  const { usage } = value
  const rows = usage.iterations?.length ? usage.iterations : [usage]
  const total = (read: (row: typeof AnthropicCompactionTokenUsageSchema.Type) => number) =>
    rows.reduce((sum, row) => sum + read(row), 0)
  const cachedTokens = total((row) => row.cache_read_input_tokens ?? 0)
  const cacheWriteTokens = total((row) => row.cache_creation_input_tokens ?? 0)
  const promptTokens = total((row) => row.input_tokens) + cachedTokens + cacheWriteTokens
  const completionTokens = total((row) => row.output_tokens)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    promptTokensDetails: {
      cachedTokens,
      cacheWriteTokens,
      cacheWrite1hTokens: total((row) => row.cache_creation?.ephemeral_1h_input_tokens ?? 0),
    },
    ...(usage.iterations ? { providerUsageDetails: { iterations: usage.iterations } } : {}),
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
