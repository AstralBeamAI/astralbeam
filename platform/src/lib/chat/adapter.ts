import {
  createModel,
  extendAdapter,
  EventType,
  type ModelMessage,
  type TextOptions,
  type AdapterYieldChunk,
  type TokenUsage,
} from "@tanstack/ai"
import { createAnthropicChat } from "@tanstack/ai-anthropic"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { createOpenRouterText } from "@tanstack/ai-openrouter"
import { HTTPClient } from "@openrouter/sdk/lib/http"
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible"
import { Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { CHAT_MAX_MODEL_TURNS } from "./constants.server"
import {
  chatWebEvidenceChunk,
  fetchChatWebProvider,
  type ChatWebObservation,
} from "./web-evidence.server"

function createProviderChatAdapter(
  configuration: ChatModelConfiguration,
  webAccessEnabled: boolean,
) {
  const { modelId, apiKey } = configuration
  const model = createModel(modelId, ["text", "image", "document"])
  if (configuration.providerType === "openai" && configuration.api === "responses") {
    // Null stops the SDK reading OPENAI_ORG_ID and OPENAI_PROJECT_ID from the deployment.
    return extendAdapter(createOpenaiChat, [model])(modelId, apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      organization: null,
      project: null,
      ...(webAccessEnabled ? { maxRetries: 0 } : {}),
    })
  }
  if (configuration.api === "anthropic-messages") {
    // Null stops the SDK sending a deployment ANTHROPIC_AUTH_TOKEN as a bearer header.
    return extendAdapter(createAnthropicChat, [model])(modelId, apiKey, {
      baseURL: configuration.baseUrl,
      fetch: configuration.fetch,
      authToken: null,
      ...(webAccessEnabled ? { maxRetries: 0 } : {}),
    })
  }
  if (configuration.providerType === "openrouter" && webAccessEnabled) {
    return extendAdapter(createOpenRouterText, [model])(modelId, apiKey, {
      serverURL: configuration.baseUrl,
      httpClient: new HTTPClient({ fetcher: configuration.fetch }),
      retryCodes: [],
    })
  }
  return openaiCompatibleText(modelId, {
    apiKey,
    baseURL: configuration.baseUrl,
    fetch: configuration.fetch,
    organization: null,
    project: null,
    api: configuration.api,
    name: configuration.providerName,
  })
}

export function createChatAdapter(configuration: ChatModelConfiguration, webAccessEnabled = false) {
  const observation: ChatWebObservation = {
    messages: [],
    replay: new Map(),
    blocks: [],
    inputJson: new Map(),
    evidence: { sources: [], citations: [] },
    usage: {},
    stopReason: undefined,
    requestBody: undefined,
    continuation: undefined,
    calls: 0,
    textOffset: 0,
  }
  const adapter = createProviderChatAdapter(
    webAccessEnabled
      ? {
          ...configuration,
          fetch: (input, init) => fetchChatWebProvider(configuration, observation, input, init),
        }
      : configuration,
    webAccessEnabled,
  )
  if (!webAccessEnabled) return adapter
  const original = adapter.chatStream.bind(adapter) as (
    options: TextOptions,
  ) => AsyncIterable<AdapterYieldChunk>
  // Preserve raw server blocks across pause_turn rather than adding a client tool-result turn.
  // https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools
  adapter.chatStream = async function* (options: TextOptions): AsyncGenerator<AdapterYieldChunk> {
    observation.messages = options.messages
    observation.replay.clear()
    observation.evidence = { sources: [], citations: [] }
    observation.textOffset = 0
    const raw: typeof observation.blocks = []
    const calls: unknown[] = []
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    let textMessageId: string | undefined
    let textContent = ""
    let textEnd: Extract<AdapterYieldChunk, { type: "TEXT_MESSAGE_END" }> | undefined
    // Text placeholders survive Anthropic's role merging. Restore raw blocks at the wire boundary.
    // https://github.com/TanStack/ai/blob/main/packages/ai-anthropic/src/adapters/text.ts
    const messages = options.messages.map((message): ModelMessage => {
      const raw: unknown = message.metadata?.astralbeamWeb
      if (
        configuration.api === "anthropic-messages" &&
        message.role === "assistant" &&
        Schema.is(Schema.Array(Schema.JsonObject))(raw)
      ) {
        const id = crypto.randomUUID()
        observation.replay.set(id, raw)
        const { toolCalls: _calls, thinking: _thinking, ...rest } = message
        return { ...rest, content: id }
      }
      // The maintained adapter rejects inline documents before serializing their supported wire format.
      // https://github.com/TanStack/ai/blob/main/packages/ai-openrouter/src/adapters/text.ts
      return configuration.providerType === "openrouter" && Array.isArray(message.content)
        ? {
            ...message,
            content: message.content.map((part) =>
              part.type === "document" && part.source.type === "data"
                ? { type: "text", content: "[Attached document]" }
                : part,
            ),
          }
        : message
    })
    try {
      for (;;) {
        if (options.request?.signal?.aborted) throw options.request.signal.reason
        if (++observation.calls > CHAT_MAX_MODEL_TURNS) {
          observation.blocks = raw
          yield chatWebEvidenceChunk(observation)
          yield {
            type: EventType.RUN_ERROR,
            timestamp: Date.now(),
            code: "web_continuation_limit",
            message: "The web operation exceeded the model-turn budget. Try a narrower request.",
            usage: {
              ...usage,
              providerUsageDetails: { calls },
            },
          }
          return
        }
        observation.blocks = []
        observation.inputJson.clear()
        observation.usage = {}
        observation.stopReason = undefined
        let terminal: Extract<AdapterYieldChunk, { type: "RUN_FINISHED" | "RUN_ERROR" }> | undefined
        for await (const chunk of original({ ...options, messages })) {
          if (options.request?.signal?.aborted) return
          if (chunk.type === EventType.RUN_STARTED && observation.continuation) continue
          if (chunk.type === EventType.TEXT_MESSAGE_START) {
            if (textMessageId) continue
            textMessageId = chunk.messageId
          }
          if (chunk.type === EventType.TEXT_MESSAGE_CONTENT && textMessageId) {
            chunk.messageId = textMessageId
            textContent += chunk.delta
            chunk.content = textContent
          }
          if (chunk.type === EventType.TEXT_MESSAGE_END) {
            textEnd = { ...chunk, messageId: textMessageId ?? chunk.messageId }
            continue
          }
          if (chunk.type === EventType.RUN_FINISHED) {
            if (terminal?.type !== EventType.RUN_ERROR) terminal = chunk
            continue
          }
          if (chunk.type === EventType.RUN_ERROR) {
            terminal = /web[_ -]?(?:search|fetch)|max_tool_calls/i.test(chunk.message)
              ? {
                  ...chunk,
                  code: "web_access_unavailable",
                  message:
                    "Web access is unavailable for this model. Ask the site owner to select a supported model or check provider web-tool permissions.",
                  error: {
                    code: "web_access_unavailable",
                    message: "The provider rejected this web access configuration.",
                  },
                  rawEvent: undefined,
                }
              : chunk
            continue
          }
          yield chunk
        }
        raw.push(...observation.blocks)
        const requestUsage = !Array.isArray(terminal?.usage) ? terminal?.usage : undefined
        calls.push({
          ...requestUsage,
          providerUsage: observation.usage,
        })
        if (requestUsage) {
          for (const key of ["promptTokens", "completionTokens", "totalTokens"] as const)
            usage[key] += requestUsage[key]
          if (typeof requestUsage.cost === "number")
            usage.cost = (usage.cost ?? 0) + requestUsage.cost
        }
        if (terminal?.type !== EventType.RUN_ERROR && observation.stopReason === "pause_turn") {
          observation.textOffset += observation.blocks.reduce(
            (length, block) => length + (typeof block.text === "string" ? block.text.length : 0),
            0,
          )
          observation.continuation = [
            ...((observation.requestBody?.messages as []) ?? []),
            { role: "assistant", content: observation.blocks },
          ]
          continue
        }
        observation.blocks = raw
        if (textEnd) yield textEnd
        yield chatWebEvidenceChunk(observation)
        if (terminal)
          yield {
            ...terminal,
            usage: {
              ...requestUsage,
              ...usage,
              providerUsageDetails: { calls },
            },
          }
        break
      }
    } finally {
      observation.continuation = undefined
    }
  }
  return adapter
}
