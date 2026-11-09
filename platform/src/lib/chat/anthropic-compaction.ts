import Anthropic from "@anthropic-ai/sdk"
import type {
  BetaMessage,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages"
import {
  createModel,
  EventType,
  extendAdapter,
  type ModelMessage,
  type TextCompactOptions,
  type TokenUsage,
} from "@tanstack/ai"
import { resolveDebugOption } from "@tanstack/ai/adapter-internals"
import {
  createAnthropicChat,
  createAnthropicChatWithClient,
  type AnthropicMessagesClient,
} from "@tanstack/ai-anthropic"
import { Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { chatAnthropicCompactionUsage } from "./compaction-usage"
import { ChatCompactionError } from "./compaction"

const ANTHROPIC_COMPACTION_BETA = "compact-2026-09-04"
const AnthropicCompactionMessageSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  stop_reason: Schema.Literal("compaction"),
  content: Schema.Tuple([
    Schema.Struct({
      type: Schema.Literal("compaction"),
      content: Schema.String.check(Schema.isNonEmpty()),
      signature: Schema.String.check(Schema.isNonEmpty()),
    }),
  ]),
})

export function createChatAnthropicCompactionAdapter(
  configuration: ChatModelConfiguration,
  onCompactionUsage?: (usage: TokenUsage) => Promise<void>,
) {
  const client = new Anthropic({
    apiKey: configuration.apiKey,
    authToken: null,
    baseURL: configuration.baseUrl,
    fetch: configuration.fetch,
  })
  const clientForRequest = (wrapFetch: TextCompactOptions["wrapFetch"]) =>
    wrapFetch
      ? client.withOptions({ fetch: wrapFetch(configuration.fetch as typeof globalThis.fetch) })
      : client
  const models = [createModel(configuration.modelId, ["text", "image", "document"])]
  const makeAdapter = (create: AnthropicMessagesClient["beta"]["messages"]["create"]) =>
    extendAdapter(createAnthropicChatWithClient, models)(configuration.modelId, {
      beta: { messages: { create } },
    })
  const adapter = extendAdapter(createAnthropicChat, models)(
    configuration.modelId,
    configuration.apiKey,
    {
      auth: "api-key",
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
    },
  )
  const chatStream = adapter.chatStream.bind(adapter)
  let supported: boolean | undefined

  return Object.assign(adapter, {
    chatStream(input: Parameters<typeof chatStream>[0]) {
      const message: unknown = input.messages[0]?.metadata?.anthropicCompaction
      if (message === undefined) return chatStream(input)
      if (!Schema.is(AnthropicCompactionMessageSchema)(message))
        throw new ChatCompactionError({ code: "compaction_failed" })
      const replayClient = clientForRequest(input.wrapFetch)
      // Inject after TanStack maps the suffix, so adjacent assistant messages cannot merge the block.
      return makeAdapter(
        (params: MessageCreateParamsStreaming, options?: Anthropic.RequestOptions) =>
          replayClient.beta.messages.create(
            {
              ...params,
              messages: [{ role: message.role, content: [...message.content] }, ...params.messages],
              betas: [...new Set([...(params.betas ?? []), ANTHROPIC_COMPACTION_BETA])],
            },
            options,
          ),
      ).chatStream({ ...input, messages: input.messages.slice(1) })
    },
    async compact(
      input: TextCompactOptions & {
        tools?: Parameters<typeof chatStream>[0]["tools"]
        maxTokens?: number
      },
    ) {
      input.signal?.throwIfAborted()
      const compactClient = clientForRequest(input.wrapFetch)
      if (supported === undefined) {
        const model = await compactClient.beta.models.retrieve(
          configuration.modelId,
          { betas: [ANTHROPIC_COMPACTION_BETA] },
          { signal: input.signal },
        )
        supported = model.capabilities?.compaction?.summarize.supported === true
      }
      if (!supported)
        throw Object.assign(new ChatCompactionError({ code: "compaction_failed" }), { status: 501 })
      let result: BetaMessage | undefined
      const previous: unknown = input.messages[0]?.metadata?.anthropicCompaction
      if (previous !== undefined && !Schema.is(AnthropicCompactionMessageSchema)(previous))
        throw new ChatCompactionError({ code: "compaction_failed" })
      // Replace this native request bridge when TanStack implements Anthropic compact().
      // https://github.com/TanStack/ai/issues/2081
      const mapper = makeAdapter(
        async (params: MessageCreateParamsStreaming, options?: Anthropic.RequestOptions) => {
          const { context_management: _context, ...request } = params
          result = await compactClient.beta.messages.create(
            {
              ...request,
              ...(Schema.is(AnthropicCompactionMessageSchema)(previous)
                ? {
                    messages: [
                      { role: previous.role, content: [...previous.content] },
                      ...params.messages,
                    ],
                  }
                : {}),
              stream: false,
              compaction: { type: "summarize" },
              betas: [...new Set([...(params.betas ?? []), ANTHROPIC_COMPACTION_BETA])],
            },
            options,
          )
          const usage = chatAnthropicCompactionUsage(result)
          if (usage) await onCompactionUsage?.(usage)
          return (async function* () {})()
        },
      )
      for await (const event of mapper.chatStream({
        model: input.model,
        messages: previous ? input.messages.slice(1) : input.messages,
        systemPrompts: input.systemPrompts ?? [],
        tools: input.tools,
        modelOptions: { max_tokens: input.maxTokens ?? 4096 },
        request: input.signal ? { signal: input.signal } : {},
        logger: resolveDebugOption(false),
        threadId: "compaction",
      })) {
        if (event.type === EventType.RUN_ERROR)
          throw new ChatCompactionError({ code: "compaction_failed" })
      }
      input.signal?.throwIfAborted()
      if (!Schema.is(AnthropicCompactionMessageSchema)(result) || !result.content[0].content.trim())
        throw new ChatCompactionError({ code: "compaction_failed" })
      return [
        {
          role: "assistant",
          content: result.content[0].content,
          metadata: { anthropicCompaction: result },
        },
      ] satisfies ModelMessage[]
    },
  })
}
