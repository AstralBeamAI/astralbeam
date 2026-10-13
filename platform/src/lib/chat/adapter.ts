import {
  createModel,
  extendAdapter,
  EventType,
  type TextOptions,
  type AdapterYieldChunk,
  type TokenUsage,
  type ContentPart,
} from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { createOpenRouterText } from "@tanstack/ai-openrouter"
import { HTTPClient } from "@openrouter/sdk/lib/http"
import type { ChatContentItems } from "@openrouter/sdk/models"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"
import { Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"

import { fetchChatWeb, type ChatWebState } from "./web"

type ChatWebTerminal = Extract<AdapterYieldChunk, { type: "RUN_FINISHED" | "RUN_ERROR" }>

function chatWebTerminal(
  terminal: ChatWebTerminal,
  usages: TokenUsage[],
  web: ChatWebState,
): ChatWebTerminal {
  web.failed ||= terminal.type === EventType.RUN_ERROR
  return {
    ...terminal,
    ...(terminal.type === EventType.RUN_ERROR &&
    /web[_ -]?(?:search|fetch)|max_tool_calls/i.test(terminal.message)
      ? {
          code: "web_access_unavailable",
          message:
            "The provider rejected web access. Check the model and provider web-tool permissions.",
        }
      : {}),
    usage: {
      ...(!Array.isArray(terminal.usage) ? terminal.usage : {}),
      promptTokens: usages.reduce((n, usage) => n + usage.promptTokens, 0),
      completionTokens: usages.reduce((n, usage) => n + usage.completionTokens, 0),
      totalTokens: usages.reduce((n, usage) => n + usage.totalTokens, 0),
      ...(web.usage.some((usage) => typeof usage.cost === "number")
        ? { cost: web.usage.reduce((n, usage) => n + Number(usage.cost ?? 0), 0) }
        : {}),
    },
  }
}

function chatWebContent(
  chunk: AdapterYieldChunk,
  state: { content: string; messageId: string | undefined },
  signal?: AbortSignal | null,
): AdapterYieldChunk | null | undefined {
  if (signal?.aborted) return null
  switch (chunk.type) {
    case EventType.TEXT_MESSAGE_START:
      if (state.messageId) return
      state.messageId = chunk.messageId
      return chunk
    case EventType.TEXT_MESSAGE_END:
      return
    case EventType.TEXT_MESSAGE_CONTENT:
      state.content += chunk.delta
      return { ...chunk, messageId: state.messageId ?? chunk.messageId, content: state.content }
    default:
      return chunk
  }
}

function createChatProviderAdapter(configuration: ChatModelConfiguration, nativeWeb: boolean) {
  if (configuration.providerType === "openai" && configuration.api === "responses") {
    const createOpenaiModel = extendAdapter(createOpenaiChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    // Null stops the SDK reading OPENAI_ORG_ID and OPENAI_PROJECT_ID from the deployment.
    return createOpenaiModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      organization: null,
      project: null,
      maxRetries: nativeWeb ? 0 : 2,
    })
  }
  if (configuration.api === "anthropic-messages") {
    const createAnthropicModel = extendAdapter(createAnthropicChat, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])
    // Explicit auth keeps deployment tokens out of this Organization's connection.
    return createAnthropicModel(configuration.modelId, configuration.apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      auth: "api-key",
      maxRetries: nativeWeb ? 0 : 2,
    })
  }
  if (configuration.providerType === "openrouter" && nativeWeb) {
    const adapter = extendAdapter(createOpenRouterText, [
      createModel(configuration.modelId, ["text", "image", "document"]),
    ])(configuration.modelId, configuration.apiKey, {
      serverURL: configuration.baseUrl,
      httpClient: new HTTPClient({ fetcher: configuration.fetch }),
      retryCodes: [],
    })
    const convert = (
      adapter as unknown as { convertContentPart(part: ContentPart): ChatContentItems | null }
    ).convertContentPart.bind(adapter)
    // The adapter rejects inline PDFs supported by OpenRouter. Keep uploaded documents working.
    // https://github.com/TanStack/ai/blob/main/packages/ai-openrouter/src/adapters/text.ts
    return Object.assign(adapter, {
      convertContentPart(part: ContentPart): ChatContentItems | null {
        if (part.type !== "document" || part.source.type !== "data") return convert(part)
        return {
          type: "file",
          file: {
            filename: Schema.is(Schema.Struct({ filename: Schema.String }))(part.metadata)
              ? part.metadata.filename
              : "attachment.pdf",
            fileData: `data:${part.source.mimeType ?? "application/pdf"};base64,${part.source.value}`,
          },
        }
      },
    })
  }
  return openaiCompatibleText(configuration.modelId, {
    apiKey: configuration.apiKey,
    baseURL: configuration.baseUrl,
    fetch: configuration.fetch,
    organization: null,
    project: null,
    api: configuration.api,
    name: configuration.providerName,
  })
}

export function createChatAdapter(model: ChatModelConfiguration, web?: ChatWebState) {
  const provider = createChatProviderAdapter(
    web ? { ...model, fetch: (input, init) => fetchChatWeb(model, web, input, init) } : model,
    web !== undefined,
  )
  const adapter = Object.assign(provider, {
    inputModalities: provider.inputModalities ?? (["text", "image", "document"] as const),
  })
  if (!web) return adapter
  const stream = adapter.chatStream.bind(adapter) as (
    options: TextOptions,
  ) => AsyncIterable<AdapterYieldChunk>
  // Native adapters omit pause_turn and citations. Keep the continuation on this provider.
  // https://github.com/TanStack/ai/blob/main/packages/ai-anthropic/src/adapters/text.ts
  adapter.chatStream = async function* (options: TextOptions): AsyncGenerator<AdapterYieldChunk> {
    web.blocks = []
    web.evidence = { sources: [], citations: [] }
    web.usage = []
    web.active = false
    web.failed = false
    web.settled = false
    web.offset = 0
    web.replay.clear()
    const messages = options.messages.map((message) => {
      const context: unknown = message.metadata?.webProviderContext
      if (!Schema.is(Schema.Array(Schema.JsonObject))(context)) return message
      const marker = crypto.randomUUID()
      web.replay.set(marker, [...context])
      const { toolCalls: _calls, thinking: _thinking, ...rest } = message
      return { ...rest, content: marker }
    })
    const previous: Schema.JsonObject[] = []
    const text = { content: "", messageId: undefined as string | undefined }
    const signal = options.request?.signal
    const usages: TokenUsage[] = []
    let terminal: ChatWebTerminal | undefined
    try {
      do {
        web.pause = false
        for await (const chunk of stream({ ...options, messages })) {
          const output = chatWebContent(chunk, text, signal)
          if (output === null) return
          if (!output) continue
          if (chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR) {
            terminal = chunk
            if (chunk.usage && !Array.isArray(chunk.usage)) usages.push(chunk.usage)
            continue
          }
          yield output
        }
        if (web.pause && terminal?.type !== EventType.RUN_ERROR) {
          previous.push(...web.blocks)
          web.offset = text.content.length
          const marker = crypto.randomUUID()
          const content = [
            ...Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(
              web.request.messages ?? [],
            ),
            { role: "assistant", content: web.blocks },
          ]
          web.replay.set(marker, content)
          messages.splice(0, messages.length, { role: "user", content: marker })
          web.blocks = []
        } else break
      } while (web.pause)
      if (text.messageId) yield { type: EventType.TEXT_MESSAGE_END, messageId: text.messageId }
      if (terminal) {
        yield chatWebTerminal(terminal, usages, web)
      }
    } finally {
      web.blocks = [...previous, ...web.blocks]
      if (signal?.aborted) web.failed ||= !web.settled
    }
  }
  return adapter
}
