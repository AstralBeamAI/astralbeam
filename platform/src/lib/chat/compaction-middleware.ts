import { createHash } from "node:crypto"
import {
  convertSchemaToJsonSchema,
  EventType,
  type AnyTextAdapter,
  type ChatMiddleware,
  type ModelMessage,
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
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          schema: inputSchema && convertSchemaToJsonSchema(inputSchema),
        })),
      }),
    )
    .digest("hex")
}

export function selectChatCompaction(
  state: ChatCompactionState,
  artifacts: ChatCompactionArtifact[],
) {
  const positions = new Map(state.history.map((message, index) => [message.id, index]))
  const safe = chatCompactionBoundaries(state.history)
  state.artifact = artifacts
    .filter(
      (entry) =>
        safe.includes(positions.get(entry.coveredThroughMessageId) ?? -1) &&
        (entry.payload.kind === "portable" || entry.compatibilityKey === state.compatibilityKey),
    )
    .sort(
      (a, b) =>
        positions.get(b.coveredThroughMessageId)! - positions.get(a.coveredThroughMessageId)! ||
        Number(a.payload.kind === "portable") - Number(b.payload.kind === "portable"),
    )[0]
}

export function estimateChatContext(message: ModelMessage) {
  const media = Array.isArray(message.content)
    ? message.content.filter((part) => part.type !== "text").length * 4096
    : 0
  const content = Array.isArray(message.content)
    ? message.content.filter((part) => part.type === "text")
    : message.content
  return estimateMessageTokens({ ...message, content }) + media
}

function boundChatCompactionToolResult(message: ModelMessage): ModelMessage {
  return message.role === "tool" &&
    typeof message.content === "string" &&
    message.content.length > 16000
    ? {
        ...message,
        content: `${message.content.slice(0, 16000)}\n[Truncated. Original saved in message ${message.id?.split(":")[0]}.]`,
      }
    : message
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
    if (size > budget * 0.6) break
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
  modelId: string
  native: boolean
  configuration: ModelConfiguration
  summaryOptions: Record<string, unknown>
  summaryMiddleware: ChatMiddleware[]
  beforeCall: () => Promise<void>
  save: (
    anchor: string,
    payload: typeof ChatCompactionPayloadSchema.Type,
  ) => Promise<ChatCompactionArtifact>
  projectSuffix: () => Promise<ModelMessage[]>
}): ChatMiddleware {
  const { state, adapter } = options
  let budget = modelInputAllowance(options.configuration)
  let systemPrompts: string[] = []
  let tools: Tool[] = []
  const summarize = conversationSummarizer({
    adapter: options.summaryAdapter,
    modelOptions: options.summaryOptions,
    middleware: [
      ...options.summaryMiddleware,
      {
        name: "compaction-summary-completion",
        onFinish(_ctx, info) {
          if (info.finishReason === "length" || info.finishReason === "max_tokens")
            throw new ChatCompactionError({ code: "compaction_failed" })
        },
      },
    ],
  })
  const compact = async (
    messages: readonly ModelMessage[],
    ctx: { signal?: AbortSignal | undefined },
    native: boolean,
  ) => {
    await options.beforeCall()
    state.usage = undefined
    if (!native && state.artifact?.payload.kind === "native") {
      state.artifact = undefined
      messages = (await options.projectSuffix()).map(boundChatCompactionToolResult)
    }
    const cut = chatCompactionCut(state, messages, budget)
    const suffix = messages.slice(cut.offset)
    let head: ModelMessage[]
    if (native) {
      // Retained Anthropic thinking requires a cut between different provider message roles.
      // https://platform.claude.com/docs/en/build-with-claude/compaction-thinking-blocks
      if (
        adapter.api === "anthropic-messages" &&
        (messages[cut.offset - 1]?.role === "assistant") === (suffix[0]?.role === "assistant")
      )
        throw new ChatCompactionError({ code: "compaction_context_full" })
      const input = {
        messages: messages.slice(0, cut.offset),
        model: options.modelId,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        systemPrompts,
        tools,
        maxTokens: Math.min(options.configuration.outputCap, 4096),
      }
      head = await adapter.compact!(input)
    } else {
      const strategy = summarizeOldest({
        summarize,
        summaryRole: "user",
        keepRecentTokens: suffix.reduce((sum, message) => sum + estimateChatContext(message), 0),
      })
      const next = await strategy(messages, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        maxTokens: budget,
        estimate: estimateChatContext,
        threadId: state.claim.threadId,
        addUsage() {}, // Summary middleware records each call's usage.
      })
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
    state.artifact = await options.save(cut.anchor, {
      version: 1,
      kind: native ? "native" : "portable",
      messages: head.map(chatStoredJson),
    })
    return [...chatCompactionMessages(state.artifact.payload), ...(await options.projectSuffix())]
  }
  const middleware = withCompaction({
    maxTokens: () => Math.floor(budget * 0.8),
    estimateTokens: estimateChatContext,
    strategy: (messages, ctx) => compact(messages, ctx, false),
    ...(options.native && adapter.compact
      ? {
          native: {
            compact: (input) => compact(input.messages, input, true),
          },
        }
      : {}),
  })
  return {
    ...middleware,
    async onConfig(ctx, config) {
      if (ctx.phase === "init") return
      tools = config.tools
      systemPrompts = config.systemPrompts.map((prompt) =>
        typeof prompt === "string" ? prompt : prompt.content,
      )
      const fixed = Math.ceil(
        JSON.stringify({
          systemPrompts: config.systemPrompts,
          tools: config.tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            schema: inputSchema && convertSchemaToJsonSchema(inputSchema),
          })),
        }).length / 3,
      )
      budget = modelInputAllowance(options.configuration) - fixed
      if (budget <= 0) throw new ChatCompactionError({ code: "compaction_instructions" })
      const working = (config.providerMessages ?? config.messages).map(
        boundChatCompactionToolResult,
      )
      let prepared
      try {
        prepared = await middleware.onConfig?.(ctx, { ...config, providerMessages: working })
      } catch (error) {
        if (ctx.signal?.aborted || error instanceof ChatCompactionError) throw error
        throw new ChatCompactionError({ code: "compaction_failed" })
      }
      const messages = (prepared?.providerMessages ?? working).map(boundChatCompactionToolResult)
      if (messages.reduce((sum, message) => sum + estimateChatContext(message), 0) > budget)
        throw new ChatCompactionError({ code: "compaction_context_full" })
      await options.beforeCall()
      return { ...prepared, providerMessages: messages }
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

export function chatCompactionOutputOptions(
  model: Pick<ChatModelConfiguration, "api" | "providerType">,
  maxTokens: number,
) {
  if (model.providerType === "openrouter") return { maxCompletionTokens: maxTokens }
  if (model.api === "responses") return { max_output_tokens: maxTokens }
  if (model.api === "gemini-generate-content") return { maxOutputTokens: maxTokens }
  return model.api === "chat-completions" && model.providerType === "openai"
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}
