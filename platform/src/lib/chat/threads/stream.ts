import {
  EventType,
  convertSchemaToJsonSchema,
  modelMessagesToUIMessages,
  type ChatMiddleware,
  type ModelMessage,
  type StreamChunk,
  type Tool,
} from "@tanstack/ai"
import {
  defineAIPersistence,
  defineMessageStore,
  getPersistenceCompletion,
  PersistenceCompletionCapability,
  withPersistence,
} from "@tanstack/ai-persistence"
import { Effect, Schema } from "effect"

import { APP_HANDLE } from "@/lib/constants"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import type { ChatThreads } from "./threads"
import type { ChatMessagePayload, ChatWriterClaim } from "./schemas"
import { chatStoredJson } from "./projection"

const CHAT_THREAD_EVENT = `${APP_HANDLE}_thread`

export interface ManagedChatExecution {
  readonly claim: ChatWriterClaim
  readonly threadVersion: number
  readonly acceptedMessageId?: string | undefined
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
  }>
  readonly model: ChatModelConfiguration
  readonly agentId: string
  readonly refreshContext?:
    | ((
        claim: ChatWriterClaim,
      ) => Promise<{ providerMessages: ModelMessage[]; tools: Tool[]; systemPrompts: string[] }>)
    | undefined
  readonly execute: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}

interface ManagedChatStreamState {
  claim: ChatWriterClaim
  tools: ManagedChatStreamOptions["tools"]
  phaseStart: number
  phaseCount: number
  committed: boolean
  finished: boolean
  failed: boolean
  version: number
  payload: ChatMessagePayload
  usage: typeof Schema.JsonObject.Type | undefined
  readonly partIds: Map<string, string>
  readonly modelIds: Map<string, string>
  readonly messageIds: Map<string, string>
  readonly settledToolCalls: Set<string>
  readonly ready: StreamChunk[]
  readonly buffered: StreamChunk[]
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
  part: typeof Schema.JsonObject.Type,
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
  const models = messages.slice(state.phaseStart).filter((message) => message.role === "assistant")
  const occurrences = new Map<string, number>()
  const occurrenceKey = (key: string) => {
    const count = occurrences.get(key) ?? 0
    occurrences.set(key, count + 1)
    return `${key}:${count}`
  }
  const parts = models
    .flatMap((model) => modelMessagesToUIMessages([model]))
    .flatMap((message) =>
      message.parts.map((part) => {
        const json = chatStoredJson(part)
        if (part.type === "tool-call") return managedToolPart(options, state, json)
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
  if (state.committed) return
  const payload = managedAssistantPayload(options, state, messages)
  if (payload.parts.length === 0 && !complete) return
  await options.execute(
    options.threads.checkpoint({
      claim: state.claim,
      payload,
      state: complete ? "complete" : "draft",
    }),
  )
  state.payload = payload
  if (complete) state.committed = true
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
  const target = part.targets[0] as typeof Schema.JsonObject.Type
  await options.execute(
    options.threads.appendToolResults({
      claim: state.claim,
      results: [
        {
          assistantMessageId: state.claim.assistantMessageId,
          toolPartId: Schema.decodeUnknownSync(Schema.String)(part.id),
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
      messages: chunk.messages.map((message) => ({
        ...message,
        id: state.messageIds.get(message.id) ?? message.id,
      })),
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
    phaseCount: 0,
    committed: false,
    finished: false,
    failed: false,
    version: options.managed.threadVersion,
    payload: { version: 1, parts: [] },
    usage: undefined,
    partIds: new Map(),
    modelIds: new Map(),
    messageIds: new Map(),
    settledToolCalls: new Set(),
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
  let completion: Promise<void> | undefined
  const checkpointInterrupted: NonNullable<ChatMiddleware["onAbort"]> = async (ctx) => {
    state.failed = true
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
      if (config) state.tools = config.tools
      return config
    },
    async onIteration(ctx, info) {
      if (state.phaseCount > 0) {
        state.ready.push(...state.buffered.splice(0))
        state.claim = await options.execute(options.threads.nextDraft({ claim: state.claim }))
      }
      state.phaseCount += 1
      state.phaseStart = ctx.messages.length
      state.committed = false
      state.payload = { version: 1, parts: [] }
      state.usage = undefined
      state.partIds.clear()
      state.modelIds.clear()
      state.settledToolCalls.clear()
      state.messageIds.set(info.messageId, state.claim.assistantMessageId)
    },
    onUsage(_ctx, usage) {
      state.usage = {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      }
    },
    async onInterruptBoundary(ctx) {
      if (ctx.phase === "beforeTools")
        await saveManagedProjection(options, state, ctx.messages, true)
    },
    async onBeforeToolCall(ctx) {
      await saveManagedProjection(options, state, ctx.messages, true)
      await options.execute(options.threads.assertActive({ claim: state.claim }))
    },
    async onAfterToolCall(_ctx, info) {
      await saveManagedToolResult(
        options,
        state,
        info.toolCallId,
        info.ok ? "succeeded" : "unknown",
        info.ok ? (info.result ?? null) : { error: "Tool execution failed", outcome: "unknown" },
      )
      if (!info.ok) {
        state.failed = true
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
      // Native completion stays pending at a browser wait. The application commits
      // that boundary and releases ownership without awaiting terminal completion.
      if (chunk.type === EventType.RUN_FINISHED && chunk.outcome?.type === "interrupt")
        completion = undefined
      const output = managedPublicChunk(state, chunk)
      if (chunk.type === EventType.RUN_ERROR) state.failed = true
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
        if (state.failed) throw new Error("Generation did not complete")
        await completion
        await saveManagedProjection(options, state, ctx.messages, true)
        await options.execute(options.threads.finish({ claim: state.claim }))
        state.version = (
          await options.execute(
            options.threads.get({ scope: state.claim.scope, id: state.claim.threadId }),
          )
        ).lockVersion
        state.finished = true
      } catch (error) {
        state.failed = true
        throw error
      }
    },
    onError: checkpointInterrupted,
    onAbort: checkpointInterrupted,
  }
  return { state, middleware: [persistence, gates] }
}

export async function* managedChatDelivery(input: {
  readonly source: AsyncIterable<StreamChunk>
  readonly managed: ManagedChatExecution
  readonly state: ReturnType<typeof managedChatMiddleware>["state"]
}): AsyncGenerator<StreamChunk> {
  yield {
    type: EventType.CUSTOM,
    name: CHAT_THREAD_EVENT,
    value: {
      threadId: input.managed.claim.threadId,
      version: input.managed.threadVersion,
      ...(input.managed.acceptedMessageId
        ? { acceptedMessageId: input.managed.acceptedMessageId }
        : {}),
      saved: false,
    },
  }
  for await (const chunk of input.source) {
    for (const committed of input.state.ready.splice(0)) yield committed
    yield chunk
  }
  if (!input.state.finished || input.state.failed)
    throw new Error("Conversation could not be saved")
  yield {
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
  }
  for (const chunk of input.state.buffered) yield chunk
}
