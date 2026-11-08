import {
  EventType,
  convertSchemaToJsonSchema,
  isProviderExecutedToolCall,
  modelMessagesToUIMessages,
  StreamProcessor,
  type ChatMiddleware,
  type ModelMessage,
  type StreamChunk,
  type Tool,
  type AnyTool,
  type UIMessage,
} from "@tanstack/ai"
import {
  defineAIPersistence,
  defineMessageStore,
  getPersistenceCompletion,
  PersistenceCompletionCapability,
  withPersistence,
} from "@tanstack/ai-persistence"
import { BigDecimal, Effect, Schema, Stream } from "effect"

import type { ChatFileCache } from "../attachments/attachments"
import { APP_HANDLE } from "@/lib/constants"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import { modelUsageCost } from "@/lib/model-providers/usage-cost"
import type { ChatThreads } from "./threads"
import type { ChatMessagePayload, ChatWriterClaim } from "./schemas"
import { chatStoredJson, chatPublicParts } from "./projection"

const CHAT_THREAD_EVENT = `${APP_HANDLE}_thread`

export interface ManagedChatExecution {
  readonly claim: ChatWriterClaim
  readonly threadVersion: number
  readonly acceptedMessageId?: string | undefined
  readonly acceptedMessage?: { id: string; parts: readonly Record<string, unknown>[] }
  readonly clientId: string
}

interface ManagedChatStreamOptions {
  readonly managed: ManagedChatExecution
  readonly threads: typeof ChatThreads.Service
  readonly history: ModelMessage[]
  readonly tools: ReadonlyArray<{
    name: string
    inputSchema?: Tool["inputSchema"]
    outputSchema?: Tool["outputSchema"]
    execute?: Tool["execute"]
    metadata?: Readonly<Record<string, unknown>> | undefined
  }>
  readonly model: ChatModelConfiguration
  readonly pricing?: ModelConfiguration | null | undefined
  readonly agentId: string
  readonly publicHistory: UIMessage[]
  readonly refreshContext?:
    | ((claim: ChatWriterClaim) => Promise<{
        providerMessages: ModelMessage[]
        tools: AnyTool[]
        systemPrompts: string[]
        publicHistory: UIMessage[]
      }>)
    | undefined
  readonly execute: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}

interface ManagedChatStreamState {
  claim: ChatWriterClaim
  tools: ManagedChatStreamOptions["tools"]
  phaseStart: number
  phase: "pending" | "streaming" | "committed"
  delivery: "streaming" | "waiting" | "saved" | "failed"
  version: number
  payload: ChatMessagePayload
  usage: Schema.JsonObject | undefined
  publicHistory: UIMessage[]
  readonly fileCache: ChatFileCache
  readonly partIds: Map<string, string>
  readonly modelIds: Map<string, string>
  readonly messageIds: Map<string, string>
  readonly settledToolCalls: Set<string>
  readonly providerProjection: StreamProcessor
  readonly ready: StreamChunk[]
  buffered: StreamChunk[]
}

function managedPartId(ids: Map<string, string>, key: string): string {
  const existing = ids.get(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  ids.set(key, id)
  return id
}

function managedToolPart(
  options: ManagedChatStreamOptions,
  state: ManagedChatStreamState,
  part: Record<string, Schema.Json>,
) {
  const nativeId = Schema.decodeUnknownSync(Schema.String)(part.id)
  const tool = state.tools.find((candidate) => candidate.name === part.name)
  const browser = tool !== undefined && !tool.execute
  const toolPartId = managedPartId(state.partIds, `tool:${nativeId}`)
  return {
    ...part,
    id: toolPartId,
    type: "tool-call",
    toolCallId: nativeId,
    executionLocation: browser
      ? "browser"
      : Schema.decodeUnknownSync(Schema.String)(part.name).startsWith("sandbox_")
        ? "sandbox"
        : "server_api",
    declaration: chatStoredJson({
      name: tool?.name ?? part.name,
      inputSchema: tool?.inputSchema ? convertSchemaToJsonSchema(tool.inputSchema) : undefined,
      outputSchema: tool?.outputSchema ? convertSchemaToJsonSchema(tool.outputSchema) : undefined,
      ...(tool?.execute && tool.metadata?.source === "mcp"
        ? {
            source: "mcp",
            title: tool.metadata.title,
            mcpServerId: tool.metadata.mcpServerId,
            connectionId: tool.metadata.connectionId,
            nativeToolName: tool.metadata.nativeToolName,
            inputSchema: tool.metadata.originalInputSchema,
          }
        : {}),
    }),
    targets: [
      {
        id: managedPartId(state.partIds, `target:${nativeId}`),
        ...(browser
          ? {
              tenantUserId: state.claim.scope.tenantUserId,
              clientId: options.managed.clientId,
            }
          : {}),
      },
    ],
  }
}

function managedAssistantPayload(
  options: ManagedChatStreamOptions,
  state: ManagedChatStreamState,
  messages: readonly ModelMessage[],
): ChatMessagePayload {
  let models = messages.slice(state.phaseStart).filter((message) => message.role === "assistant")
  // Restore omitted provider-only calls with their native text/thinking block order intact.
  // https://tanstack.com/ai/latest/docs/tools/provider-tools#multi-turn-persistence
  const projected = state.providerProjection
    .toModelMessages()
    .filter((message) => message.role === "assistant")
  if (
    projected.some((message) =>
      message.toolCalls?.some(
        (call) =>
          isProviderExecutedToolCall(call) &&
          !models.some((model) => model.toolCalls?.some((existing) => existing.id === call.id)),
      ),
    )
  ) {
    models = projected.map((message) => ({
      ...message,
      metadata: {
        ...message.metadata,
        ...models.find((model) => model.id === message.id)?.metadata,
      },
    }))
  }
  const occurrences = new Map<string, number>()
  const occurrenceKey = (key: string) => {
    const count = occurrences.get(key) ?? 0
    occurrences.set(key, count + 1)
    return `${key}:${count}`
  }
  const parts: ChatMessagePayload["parts"][number][] = models
    .flatMap((model) => modelMessagesToUIMessages([model]))
    .flatMap((message) =>
      message.parts.map((part) => {
        const json = { ...chatStoredJson(part) }
        if (part.type === "tool-call") {
          if (!isProviderExecutedToolCall(part)) return managedToolPart(options, state, json)
          return {
            ...json,
            id: managedPartId(state.partIds, `tool:${part.id}`),
            type: "tool-call",
            toolCallId: part.id,
            executionLocation: "provider",
            state: "complete",
            targets: [],
          }
        }
        const key = `${message.id}:${part.type}:${"stepId" in part ? part.stepId : ""}`
        return { ...json, type: part.type, id: managedPartId(state.partIds, occurrenceKey(key)) }
      }),
    )
  return {
    version: 1,
    parts,
    modelMessages: models.map((message) =>
      chatStoredJson({
        ...message,
        id: managedPartId(
          state.modelIds,
          occurrenceKey(`model:${message.id}:${message.role}:${message.toolCallId ?? ""}`),
        ),
      }),
    ),
    invocationId: state.claim.invocationId,
    turnId: state.claim.inputMessageId,
    provenance: {
      agentId: options.agentId,
      providerId: options.model.providerId,
      providerType: options.model.providerType,
      protocol: options.model.api,
      modelId: options.model.modelId,
      ...(state.usage ? { usage: state.usage } : {}),
    },
  }
}

async function saveManagedProjection(
  options: ManagedChatStreamOptions,
  state: ManagedChatStreamState,
  messages: readonly ModelMessage[],
  complete: boolean,
) {
  if (state.phase === "committed") return
  const payload = managedAssistantPayload(options, state, messages)
  if (payload.parts.length === 0 && !state.usage && !complete) return
  await options.execute(
    options.threads.checkpoint({
      claim: state.claim,
      payload,
      state: complete ? "complete" : "draft",
      cache: state.fileCache,
    }),
  )
  state.payload = payload
  if (complete) state.phase = "committed"
}

async function saveManagedToolResult(
  options: ManagedChatStreamOptions,
  state: ManagedChatStreamState,
  toolCallId: string,
  outcome: "succeeded" | "failed" | "unknown",
  result: unknown,
) {
  const part = state.payload.parts.find((candidate) => candidate.toolCallId === toolCallId)
  if (!part || !Array.isArray(part.targets)) throw new Error("Uncommitted tool decision")
  const target = part.targets[0] as Schema.JsonObject
  await options.execute(
    options.threads.appendToolResults({
      claim: state.claim,
      results: [
        {
          assistantMessageId: state.claim.assistantMessageId,
          toolPartId: Schema.decodeSync(Schema.String)(part.id),
          responseTargetId: Schema.decodeUnknownSync(Schema.String)(target.id),
          payload: {
            version: 1,
            parts: [
              {
                type: "tool-result",
                id: crypto.randomUUID(),
                toolCallId,
                output: chatStoredJson({ result }).result!,
                outcome,
              },
            ],
            invocationId: state.claim.invocationId,
            turnId: state.claim.inputMessageId,
          },
        },
      ],
    }),
  )
  state.settledToolCalls.add(toolCallId)
}

function managedPublicChunk(state: ManagedChatStreamState, chunk: StreamChunk): StreamChunk {
  if (chunk.type === EventType.MESSAGES_SNAPSHOT) {
    return {
      ...chunk,
      messages: [
        ...state.publicHistory.filter((message) => message.id !== state.claim.assistantMessageId),
        {
          id: state.claim.assistantMessageId,
          role: "assistant",
          parts: chatPublicParts(state.payload.parts),
        },
      ] as unknown as Extract<StreamChunk, { type: "MESSAGES_SNAPSHOT" }>["messages"],
    }
  }
  if (chunk.type === EventType.TEXT_MESSAGE_START)
    state.messageIds.set(chunk.messageId, state.claim.assistantMessageId)
  if ("messageId" in chunk && typeof chunk.messageId === "string") {
    const messageId = state.messageIds.get(chunk.messageId) ?? state.claim.assistantMessageId
    state.messageIds.set(chunk.messageId, messageId)
    return { ...chunk, messageId }
  }
  if (chunk.type === EventType.TOOL_CALL_START) {
    return { ...chunk, parentMessageId: state.claim.assistantMessageId }
  }
  return chunk
}

/** Native persistence owns snapshot timing. Application hooks own execution and commit gates. */
export function managedChatMiddleware(options: ManagedChatStreamOptions) {
  const state: ManagedChatStreamState = {
    claim: options.managed.claim,
    tools: options.tools,
    phaseStart: options.history.length,
    phase: "pending",
    delivery: "streaming",
    version: options.managed.threadVersion,
    payload: { version: 1, parts: [] },
    usage: undefined,
    publicHistory: options.publicHistory,
    fileCache: new Map(),
    partIds: new Map(),
    modelIds: new Map(),
    messageIds: new Map(),
    settledToolCalls: new Set(),
    providerProjection: new StreamProcessor(),
    ready: [],
    buffered: [],
  }
  for (const message of options.history) {
    const meta: unknown = message.metadata?.astralbeam
    const logicalId =
      meta && typeof meta === "object" && "messageId" in meta ? meta.messageId : undefined
    if (message.id && typeof logicalId === "string") state.messageIds.set(message.id, logicalId)
  }
  // This invocation-scoped store reconciles the full trusted projection, never browser history.
  // Canonical nodes outside this writer remain immutable, including concurrent participant input.
  const persistence = withPersistence(
    defineAIPersistence({
      stores: {
        messages: defineMessageStore({
          loadThread: (threadId) => {
            if (threadId !== state.claim.threadId) throw new Error("Conversation mismatch")
            return Promise.resolve(options.history)
          },
          saveThread: async (threadId, messages) => {
            if (threadId !== state.claim.threadId) throw new Error("Conversation mismatch")
            if (
              messages.length < options.history.length ||
              options.history.some(
                (original, index) => JSON.stringify(original) !== JSON.stringify(messages[index]),
              )
            )
              throw new Error("Canonical history cannot be replaced")
            await saveManagedProjection(options, state, messages, false)
          },
        }),
      },
    }),
    { snapshotStreaming: true, snapshotIntervalMs: 1000 },
  )
  const guardedToolCalls = new Set<string>()
  let completion: Promise<void> | undefined
  const checkpointInterrupted: NonNullable<ChatMiddleware["onAbort"]> = async (ctx) => {
    state.delivery = "failed"
    await saveManagedProjection(
      options,
      state,
      [
        ...ctx.messages,
        {
          id: ctx.currentMessageId ?? state.claim.assistantMessageId,
          role: "assistant",
          content: ctx.accumulatedContent,
        },
      ],
      false,
    )
  }
  const gates: ChatMiddleware = {
    name: "managed-thread",
    requires: [PersistenceCompletionCapability],
    setup(ctx) {
      completion = getPersistenceCompletion(ctx).waitForRunCompletion()
    },
    async onConfig() {
      await options.execute(options.threads.assertActive({ claim: state.claim }))
      const config = await options.refreshContext?.(state.claim)
      if (config) {
        state.tools = config.tools
        state.publicHistory = config.publicHistory
      }
      return config
    },
    async onIteration(ctx, info) {
      if (state.phase !== "pending") {
        state.ready.push(...state.buffered.splice(0))
        state.claim = await options.execute(options.threads.nextDraft({ claim: state.claim }))
      }
      state.phaseStart = ctx.messages.length
      state.phase = "streaming"
      state.payload = { version: 1, parts: [] }
      state.usage = undefined
      state.partIds.clear()
      state.modelIds.clear()
      state.settledToolCalls.clear()
      state.providerProjection.clearMessages()
      guardedToolCalls.clear()
      state.messageIds.set(info.messageId, state.claim.assistantMessageId)
    },
    onUsage(_ctx, usage) {
      state.usage = chatStoredJson({
        ...usage,
        costUsd:
          typeof usage.cost === "number" && Number.isFinite(usage.cost)
            ? BigDecimal.format(BigDecimal.fromNumberUnsafe(usage.cost))
            : options.pricing
              ? modelUsageCost(options.pricing, usage)
              : null,
      })
    },
    async onInterruptBoundary(ctx) {
      if (ctx.phase === "beforeTools")
        await saveManagedProjection(options, state, ctx.messages, true)
    },
    async onBeforeToolCall(ctx) {
      await saveManagedProjection(options, state, ctx.messages, true)
    },
    async onGuardToolCall(_ctx, info) {
      await options.execute(options.threads.assertActive({ claim: state.claim }))
      guardedToolCalls.add(info.toolCallId)
    },
    async onAfterToolCall(_ctx, info) {
      // Validation failures have no external outcome. A passed guard only establishes eligibility.
      if (!info.ok && !guardedToolCalls.has(info.toolCallId)) return
      await saveManagedToolResult(
        options,
        state,
        info.toolCallId,
        info.ok ? "succeeded" : "unknown",
        info.ok ? (info.result ?? null) : { error: "Tool execution failed", outcome: "unknown" },
      )
      if (!info.ok) {
        state.delivery = "failed"
        throw new Error("The tool outcome is unconfirmed")
      }
    },
    async onToolPhaseComplete(_ctx, info) {
      // Input validation failures bypass execution hooks. Settle them before the next draft.
      // https://tanstack.com/ai/latest/docs/guides/middleware
      for (const result of info.results) {
        if (state.settledToolCalls.has(result.toolCallId)) continue
        await saveManagedToolResult(options, state, result.toolCallId, "failed", result.result)
      }
    },
    onChunk(_ctx, chunk) {
      if (chunk.type !== EventType.MESSAGES_SNAPSHOT) state.providerProjection.processChunk(chunk)
      // The committed snapshot carries completed provider tools without reopening them as pending.
      if (chunk.type.startsWith("TOOL_CALL_") && isProviderExecutedToolCall(chunk)) return null
      // Native persistence waits for terminal completion, which a browser-tool pause never reaches.
      if (
        chunk.type === EventType.RUN_FINISHED &&
        chunk.outcome?.type === "interrupt" &&
        state.delivery !== "failed"
      )
        state.delivery = "waiting"
      const output = managedPublicChunk(state, chunk)
      if (chunk.type === EventType.RUN_ERROR) state.delivery = "failed"
      if (
        chunk.type === EventType.MESSAGES_SNAPSHOT ||
        chunk.type === EventType.RUN_FINISHED ||
        chunk.type.startsWith("TOOL_CALL_")
      ) {
        if (chunk.type === EventType.MESSAGES_SNAPSHOT) {
          const previous = state.buffered.findIndex(
            (event) => event.type === EventType.MESSAGES_SNAPSHOT,
          )
          if (previous !== -1) state.buffered.splice(previous, 1)
        }
        state.buffered.push(output)
        return null
      }
      return output
    },
    async onFinish(ctx) {
      try {
        if (state.delivery === "failed") throw new Error("Generation did not complete")
        if (state.delivery !== "waiting") await completion
        await saveManagedProjection(options, state, ctx.messages, true)
        state.buffered = [
          managedPublicChunk(state, { type: EventType.MESSAGES_SNAPSHOT, messages: [] }),
          ...state.buffered.filter((chunk) => chunk.type !== EventType.MESSAGES_SNAPSHOT),
        ]
        await options.execute(options.threads.finish({ claim: state.claim }))
        state.version = (
          await options.execute(
            options.threads.get({ scope: state.claim.scope, id: state.claim.threadId }),
          )
        ).lockVersion
        state.delivery = "saved"
      } catch (error) {
        state.delivery = "failed"
        throw error
      }
    },
    onError: checkpointInterrupted,
    onAbort: checkpointInterrupted,
  }
  return { state, middleware: [persistence, gates] }
}

export function managedChatDelivery<E, R>(input: {
  readonly source: Stream.Stream<StreamChunk, E, R>
  readonly managed: ManagedChatExecution
  readonly state: ReturnType<typeof managedChatMiddleware>["state"]
}) {
  return Stream.concat(
    Stream.fromIterable<StreamChunk>([
      {
        type: EventType.CUSTOM,
        name: CHAT_THREAD_EVENT,
        value: {
          threadId: input.managed.claim.threadId,
          version: input.managed.threadVersion,
          ...(input.managed.acceptedMessageId
            ? { acceptedMessageId: input.managed.acceptedMessageId }
            : {}),
          ...(input.managed.acceptedMessage
            ? { acceptedMessage: input.managed.acceptedMessage }
            : {}),
          saved: false,
        },
      },
    ]),
    Stream.concat(
      input.source.pipe(
        Stream.flatMap((chunk) => Stream.fromIterable([...input.state.ready.splice(0), chunk])),
      ),
      Stream.suspend(() => {
        if (input.state.delivery !== "saved")
          return Stream.die(new Error("Conversation could not be saved"))
        return Stream.fromIterable<StreamChunk>([
          {
            type: EventType.CUSTOM,
            name: CHAT_THREAD_EVENT,
            value: {
              threadId: input.managed.claim.threadId,
              version: input.state.version,
              saved: true,
              executableToolCallIds: input.state.payload.parts
                .filter((part) => part.type === "tool-call" && part.executionLocation === "browser")
                .map((part) => part.toolCallId),
            },
          },
          ...input.state.buffered,
        ])
      }),
    ),
  )
}
