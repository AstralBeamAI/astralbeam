import { createHash } from "node:crypto"
import {
  convertSchemaToJsonSchema,
  EventType,
  type AnyTextAdapter,
  type ChatMiddleware,
  type ModelMessage,
  type TextCompactOptions,
  type TokenUsage,
  type Tool,
} from "@tanstack/ai"
import {
  COMPACTION_STARTED_EVENT,
  COMPACTION_ENDED_EVENT,
  COMPACTION_STATE_EVENT,
  conversationSummarizer,
  estimateMessageTokens,
  summarizeOldest,
  withCompaction,
  type CompactionContext,
} from "@tanstack/ai-compaction"
import type { Schema } from "effect"
import type { chatCompaction } from "@/db/schema/chat"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { modelInputAllowance, type ModelConfiguration } from "@/lib/model-providers/schemas"
import type { MessageRecord } from "./threads/threads"
import { chatStoredJson } from "./threads/projection"
import { chatNativeCompactionUsage } from "./compaction-usage"
import {
  ChatCompactionError,
  chatCompactionBoundaries,
  type ChatCompactionPayloadSchema,
} from "./compaction"

export type ChatCompactionArtifact = typeof chatCompaction.$inferSelect
export interface ChatCompactionState {
  history: MessageRecord[]
  artifact?: ChatCompactionArtifact | undefined
  portableFallback?: ChatCompactionArtifact | undefined
  compatibilityKey: string
  usage?: Schema.JsonObject | undefined
}

export const chatCompactionContextKey = (state: ChatCompactionState) =>
  state.artifact?.payload.kind === "portable" ? state.artifact.id : undefined

const chatCompactionTools = (tools: Tool[]) =>
  tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    schema: inputSchema && convertSchemaToJsonSchema(inputSchema),
  }))

export function chatCompactionKey(
  model: ChatModelConfiguration,
  systemPrompts: string[],
  tools: Tool[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        providerId: model.providerId,
        api: model.api,
        modelId: model.modelId,
        endpoint: model.baseUrl,
        systemPrompts,
        tools: chatCompactionTools(tools),
      }),
    )
    .digest("hex")
}

export function selectChatCompaction(
  state: ChatCompactionState,
  artifacts: ChatCompactionArtifact[],
  native: boolean,
) {
  const positions = new Map(state.history.map((message, index) => [message.id, index]))
  const safe = new Set(chatCompactionBoundaries(state.history))
  const eligible = artifacts
    .filter(
      (entry) =>
        safe.has(positions.get(entry.coveredThroughMessageId) ?? -1) &&
        (entry.payload.kind === "portable" ||
          (native && entry.compatibilityKey === state.compatibilityKey)),
    )
    .sort(
      (a, b) =>
        positions.get(b.coveredThroughMessageId)! - positions.get(a.coveredThroughMessageId)! ||
        Number(a.payload.kind === "portable") - Number(b.payload.kind === "portable"),
    )
  state.artifact = eligible[0]
  state.portableFallback =
    state.artifact?.payload.kind === "native"
      ? eligible.find((entry) => entry.payload.kind === "portable")
      : undefined
}

function estimateChatContext(message: ModelMessage) {
  if (!Array.isArray(message.content)) return estimateMessageTokens(message)
  const content = message.content.filter((part) => part.type === "text")
  return (
    estimateMessageTokens({ ...message, content }) +
    (message.content.length - content.length) * 4096
  )
}

function chatCompactionCut(
  state: ChatCompactionState,
  messages: readonly ModelMessage[],
  budget: number,
) {
  const positions = new Map(state.history.map((message, index) => [message.id, index]))
  const start = state.artifact ? positions.get(state.artifact.coveredThroughMessageId)! : -1
  let chosen: { anchor: string; offset: number; size: number } | undefined
  let offset = 0
  let size = 0
  for (const index of chatCompactionBoundaries(state.history)) {
    if (index <= start) continue
    while (offset < messages.length) {
      const message = messages[offset]!
      if ((positions.get(message.id?.split(":")[0] ?? "") ?? -1) > index) break
      size += estimateChatContext(message)
      offset++
    }
    if (!offset) continue
    if (offset === messages.length) break
    if (size > budget || (chosen && size > budget * 0.6)) break
    chosen = { anchor: state.history[index]!.id, offset, size }
    if (size > budget * 0.45) break
  }
  if (!chosen) throw new ChatCompactionError({ code: "compaction_context_full" })
  return chosen
}

export function createChatCompactionMiddleware(options: {
  state: ChatCompactionState
  adapter: AnyTextAdapter
  native: boolean
  configuration: ModelConfiguration
  summaryOptions: Record<string, unknown>
  onUsage: (usage: TokenUsage) => Promise<void>
  beforeCall: () => Promise<void>
  save: (
    anchor: string,
    payload: typeof ChatCompactionPayloadSchema.Type,
  ) => Promise<ChatCompactionArtifact>
  projectContext: () => Promise<ModelMessage[]>
}): ChatMiddleware {
  const { state, adapter } = options
  let budget = modelInputAllowance(options.configuration)
  let preparation: {
    attempted: boolean
    candidate?: { anchor: string; payload: ChatCompactionArtifact["payload"] }
  } = { attempted: false }
  let request: { key: string; messages: string[]; fixed: number; estimated: number } | undefined
  let measured: { key: string; messages: string[]; scale: number } | undefined
  const measuredTokens = new Map<ModelMessage, number>()
  const estimate = (message: ModelMessage) =>
    measuredTokens.get(message) ?? estimateChatContext(message)
  const summarize = conversationSummarizer({
    adapter,
    modelOptions: options.summaryOptions,
    middleware: [
      {
        name: "compaction-summary-completion",
        onUsage: (_ctx, usage) => options.onUsage(usage),
        onFinish(_ctx, info) {
          if (
            info.finishReason === "length" ||
            info.finishReason === "max_tokens" ||
            info.finishReason === "content_filter"
          )
            throw new ChatCompactionError({ code: "compaction_failed" })
        },
      },
    ],
  })
  const compact = async (
    messages: readonly ModelMessage[],
    ctx: CompactionContext | TextCompactOptions,
  ) => {
    const native = "model" in ctx
    preparation.attempted = true
    await options.beforeCall()
    state.usage = undefined
    if (!native && state.artifact?.payload.kind === "native") {
      state.artifact = state.portableFallback
      messages = await options.projectContext()
    }
    const cut = chatCompactionCut(state, messages, budget)
    const suffix = messages.slice(cut.offset)
    let head: ModelMessage[]
    if (native) {
      const usage: TokenUsage[] = []
      try {
        head = await adapter.compact!({
          ...ctx,
          messages: messages.slice(0, cut.offset),
          modelOptions: { ...ctx.modelOptions, ...options.summaryOptions },
          addUsage: (value) => {
            usage.push(chatNativeCompactionUsage(value))
            ctx.addUsage?.(value)
          },
        })
      } finally {
        for (const value of usage) await options.onUsage(value)
      }
    } else {
      const strategy = summarizeOldest({
        summarize,
        summaryRole: "user",
        keepRecentTokens: suffix.length,
      })
      // Count messages to keep the canonical cut even when a message has no text tokens.
      const next = await strategy(messages, { ...ctx, estimate: () => 1 })
      if (next?.length !== suffix.length + 1)
        throw new ChatCompactionError({ code: "compaction_context_full" })
      head = next.slice(0, 1)
    }
    if (
      !head.length ||
      head.reduce((sum, message) => sum + estimateChatContext(message), 0) >= cut.size
    )
      throw new ChatCompactionError({ code: "compaction_failed" })
    ctx.signal?.throwIfAborted()
    preparation.candidate = {
      anchor: cut.anchor,
      payload: {
        version: 1,
        kind: native ? "native" : "portable",
        messages: head.map(chatStoredJson),
      },
    }
    return [...head, ...suffix]
  }
  const middleware = withCompaction({
    maxTokens: () => {
      const settled = chatCompactionBoundaries(state.history).at(-1) ?? -1
      const covered = state.history.findIndex(
        (message) => message.id === state.artifact?.coveredThroughMessageId,
      )
      return Math.floor(budget * (settled > covered ? 0.8 : 1))
    },
    estimateTokens: estimate,
    continueOnError: true,
    strategy: compact,
    ...(options.native && adapter.compact
      ? {
          native: {
            compact: (input) => compact(input.messages, input),
          },
        }
      : {}),
  })
  return {
    ...middleware,
    async onConfig(ctx, config) {
      if (ctx.phase === "init") return
      const key = JSON.stringify({
        systemPrompts: config.systemPrompts,
        tools: chatCompactionTools(config.tools),
      })
      const fixed = Math.ceil(key.length / 3)
      budget = modelInputAllowance(options.configuration) - fixed
      if (budget <= 0) throw new ChatCompactionError({ code: "compaction_instructions" })
      const working = config.providerMessages ?? config.messages
      const serialized = working.map((message) => JSON.stringify(message))
      measuredTokens.clear()
      // Reported usage can calibrate an unchanged prefix of the provider projection.
      if (measured?.key === key && measured.messages.every((value, i) => value === serialized[i])) {
        for (const message of working.slice(0, measured.messages.length))
          measuredTokens.set(message, Math.ceil(estimateChatContext(message) * measured.scale))
      }
      const original = state.artifact
      preparation = { attempted: false }
      let prepared
      try {
        prepared = await middleware.onConfig?.(ctx, { ...config, providerMessages: working })
      } catch (error) {
        if (ctx.signal?.aborted || error instanceof ChatCompactionError) throw error
        throw new ChatCompactionError({ code: "compaction_failed" })
      }
      const { candidate, attempted } = preparation
      let messages = prepared?.providerMessages ?? working
      if (candidate) {
        // Publication failures must remain fatal, outside TanStack's recoverable summary failure path.
        ctx.signal?.throwIfAborted()
        state.artifact = await options.save(candidate.anchor, candidate.payload)
        messages = await options.projectContext()
      } else state.artifact = original
      if (messages.reduce((sum, message) => sum + estimate(message), 0) > budget)
        throw new ChatCompactionError({ code: "compaction_context_full" })
      if (attempted) await options.beforeCall()
      request = {
        key,
        messages:
          messages === working ? serialized : messages.map((message) => JSON.stringify(message)),
        estimated: messages.reduce((sum, message) => sum + estimateChatContext(message), 0),
        fixed,
      }
      return { ...prepared, providerMessages: messages }
    },
    onUsage(_ctx, usage) {
      if (!request || !request.estimated || usage.promptTokens <= request.fixed) return
      measured = {
        key: request.key,
        messages: request.messages,
        scale: (usage.promptTokens - request.fixed) / request.estimated,
      }
    },
    onChunk(_ctx, chunk) {
      if (chunk.type !== EventType.CUSTOM) return
      if (chunk.name === COMPACTION_STATE_EVENT) return null
      if (chunk.name === COMPACTION_STARTED_EVENT || chunk.name === COMPACTION_ENDED_EVENT)
        return { ...chunk, value: {} }
      return undefined
    },
  }
}
