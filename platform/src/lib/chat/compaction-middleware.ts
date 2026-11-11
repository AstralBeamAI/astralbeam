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
import { Schema } from "effect"
import type { chatCompaction } from "@/db/schema/chat"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { modelInputAllowance, type ModelConfiguration } from "@/lib/model-providers/schemas"
import type { MessageRecord } from "./threads/threads"
import type { ChatWriterClaim } from "./threads/schemas"
import { chatStoredJson } from "./threads/projection"
import {
  ChatCompactionError,
  chatCompactionBoundaries,
  chatCompactionMessages,
  type ChatCompactionPayloadSchema,
} from "./compaction"

export type ChatCompactionArtifact = typeof chatCompaction.$inferSelect
export interface ChatCompactionState {
  history: MessageRecord[]
  claim: ChatWriterClaim
  artifact?: ChatCompactionArtifact | undefined
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
  const safe = chatCompactionBoundaries(state.history)
  state.artifact = artifacts
    .filter(
      (entry) =>
        safe.includes(positions.get(entry.coveredThroughMessageId) ?? -1) &&
        (entry.payload.kind === "portable" ||
          (native && entry.compatibilityKey === state.compatibilityKey)),
    )
    .sort(
      (a, b) =>
        positions.get(b.coveredThroughMessageId)! - positions.get(a.coveredThroughMessageId)! ||
        Number(a.payload.kind === "portable") - Number(b.payload.kind === "portable"),
    )[0]
}

function estimateChatContext(message: ModelMessage) {
  const media = Array.isArray(message.content)
    ? message.content.filter((part) => part.type !== "text").length * 4096
    : 0
  const content = Array.isArray(message.content)
    ? message.content.filter((part) => part.type === "text")
    : message.content
  return estimateMessageTokens({ ...message, content }) + media
}

function chatCompactionCut(
  state: ChatCompactionState,
  messages: readonly ModelMessage[],
  budget: number,
) {
  const positions = new Map(state.history.map((message, index) => [message.id, index]))
  const start = state.artifact ? positions.get(state.artifact.coveredThroughMessageId)! : -1
  let chosen: { anchor: string; offset: number } | undefined
  for (const index of chatCompactionBoundaries(state.history)) {
    if (index <= start) continue
    const offset = messages.findIndex(
      (message) => (positions.get(message.id?.split(":")[0] ?? "") ?? -1) > index,
    )
    if (offset <= 0) continue
    const size = messages
      .slice(0, offset)
      .reduce((sum, message) => sum + estimateChatContext(message), 0)
    if (size > budget || (chosen && size > budget * 0.6)) break
    chosen = { anchor: state.history[index]!.id, offset }
    if (size > budget * 0.45) break
  }
  if (!chosen) throw new ChatCompactionError({ code: "compaction_context_full" })
  return chosen
}

export function createChatCompactionMiddleware(options: {
  state: ChatCompactionState
  adapter: AnyTextAdapter
  summaryAdapter: AnyTextAdapter
  native: boolean
  configuration: ModelConfiguration
  summaryOptions: Record<string, unknown>
  onUsage: (usage: TokenUsage) => Promise<void>
  onMetrics: (metrics: Schema.JsonObject) => Promise<void>
  beforeCall: () => Promise<void>
  save: (
    anchor: string,
    payload: typeof ChatCompactionPayloadSchema.Type,
  ) => Promise<ChatCompactionArtifact>
  projectSuffix: () => Promise<ModelMessage[]>
}): ChatMiddleware {
  const { state, adapter } = options
  let budget = modelInputAllowance(options.configuration)
  let tools: Tool[] = []
  let preparation: {
    attempts: number
    candidate?: { anchor: string; payload: ChatCompactionArtifact["payload"] }
  } = { attempts: 0 }
  let request: { key: string; messages: string[]; estimated: number; fixed: number } | undefined
  let measured: { key: string; messages: string[]; tokens: number } | undefined
  let measuredTokens = new Map<string, number>()
  const estimate = (message: ModelMessage) =>
    measuredTokens.get(JSON.stringify(message)) ?? estimateChatContext(message)
  const summarize = conversationSummarizer({
    adapter: options.summaryAdapter,
    modelOptions: options.summaryOptions,
    middleware: [
      {
        name: "compaction-summary-completion",
        onUsage: (_ctx, usage) => options.onUsage(usage),
        onFinish(_ctx, info) {
          if (info.finishReason === "length" || info.finishReason === "max_tokens")
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
    await options.beforeCall()
    preparation.attempts += 1
    state.usage = undefined
    if (!native && state.artifact?.payload.kind === "native") {
      state.artifact = undefined
      messages = await options.projectSuffix()
    }
    const cut = chatCompactionCut(state, messages, budget)
    const suffix = messages.slice(cut.offset)
    let head: ModelMessage[]
    if (native) {
      const input = {
        ...ctx,
        messages: messages.slice(0, cut.offset),
        tools,
        maxTokens: Math.min(options.configuration.outputCap, 4096),
      }
      head = await adapter.compact!(input)
    } else {
      const strategy = summarizeOldest({
        summarize,
        summaryRole: "user",
        keepRecentTokens: suffix.reduce((sum, message) => sum + ctx.estimate(message), 0),
      })
      const next = await strategy(messages, ctx)
      if (!next) throw new ChatCompactionError({ code: "compaction_context_full" })
      head = next.slice(0, 1)
    }
    if (
      !head.length ||
      head.reduce((sum, message) => sum + estimateChatContext(message), 0) >=
        messages
          .slice(0, cut.offset)
          .reduce((sum, message) => sum + estimateChatContext(message), 0)
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
      tools = config.tools
      const key = JSON.stringify({
        systemPrompts: config.systemPrompts,
        tools: chatCompactionTools(config.tools),
      })
      const fixed = Math.ceil(key.length / 3)
      budget = modelInputAllowance(options.configuration) - fixed
      if (budget <= 0) throw new ChatCompactionError({ code: "compaction_instructions" })
      const working = config.providerMessages ?? config.messages
      const serialized = working.map((message) => JSON.stringify(message))
      measuredTokens = new Map()
      // TanStack's usage counter currently keys canonical messages, not our provider projection.
      if (measured?.key === key && measured.messages.every((value, i) => value === serialized[i])) {
        const prefix = working.slice(0, measured.messages.length)
        const estimated = prefix.reduce((sum, message) => sum + estimateChatContext(message), 0)
        if (estimated > 0)
          for (const message of prefix)
            measuredTokens.set(
              JSON.stringify(message),
              Math.ceil((estimateChatContext(message) * measured.tokens) / estimated),
            )
      }
      const original = state.artifact
      preparation = { attempts: 0 }
      const started = Date.now()
      let prepared
      try {
        prepared = await middleware.onConfig?.(ctx, { ...config, providerMessages: working })
      } catch (error) {
        if (ctx.signal?.aborted || error instanceof ChatCompactionError) throw error
        throw new ChatCompactionError({ code: "compaction_failed" })
      }
      const candidate = preparation.candidate
      let messages = prepared?.providerMessages ?? working
      if (candidate) {
        // Publication failures must remain fatal, outside TanStack's recoverable summary failure path.
        state.artifact = await options.save(candidate.anchor, candidate.payload)
        messages = [
          ...chatCompactionMessages(state.artifact.payload),
          ...(await options.projectSuffix()),
        ]
      } else state.artifact = original
      if (messages.reduce((sum, message) => sum + estimate(message), 0) > budget)
        throw new ChatCompactionError({ code: "compaction_context_full" })
      await options.beforeCall()
      request = {
        key,
        messages: messages.map((message) => JSON.stringify(message)),
        estimated: messages.reduce((sum, message) => sum + estimateChatContext(message), 0),
        fixed,
      }
      await options.onMetrics({
        beforeInputTokens: working.reduce((sum, message) => sum + estimate(message), fixed),
        inputTokens: messages.reduce((sum, message) => sum + estimate(message), fixed),
        countKind: measuredTokens.size && !candidate ? "usage_adjusted" : "estimated",
        compacted: Boolean(candidate),
        compactionAttempts: preparation.attempts,
        portableFallback: options.native && candidate?.payload.kind === "portable",
        durationMs: Date.now() - started,
      })
      return { ...prepared, providerMessages: messages }
    },
    async onUsage(_ctx, usage) {
      if (!request || usage.promptTokens <= request.fixed) return
      measured = {
        key: request.key,
        messages: request.messages,
        tokens: usage.promptTokens - request.fixed,
      }
      await options.onMetrics({
        estimatedInputTokens: request.estimated + request.fixed,
        actualInputTokens: usage.promptTokens,
      })
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
