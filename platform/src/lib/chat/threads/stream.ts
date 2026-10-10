import {
  EventType,
  convertSchemaToJsonSchema,
  modelMessagesToUIMessages,
  convertMessagesToModelMessages,
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
import { chatStoredJson, settleChatWebActivity } from "./projection"
import { CHAT_WEB_EVIDENCE_EVENT, ChatWebEvidenceSchema, publicChatWebPart } from "../web-evidence"

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
  readonly publicHistory?: readonly ManagedAssistantMessage[] | undefined
  readonly tools: ReadonlyArray<{
    name: string
    inputSchema?: Tool["inputSchema"]
    outputSchema?: Tool["outputSchema"]
    execute?: Tool["execute"]
  }>
  readonly model: ChatModelConfiguration
  readonly agentId: string
  readonly refreshContext?:
    | ((claim: ChatWriterClaim) => Promise<{
        providerMessages: ModelMessage[]
        tools: Tool[]
        systemPrompts: string[]
        publicHistory?: readonly ManagedAssistantMessage[]
      }>)
    | undefined
  readonly execute: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
}

interface ManagedAssistantMessage {
  id: string
  role: "assistant"
  content: string
  parts: (typeof Schema.JsonObject.Type)[]
}

type ManagedNativePart = Record<string, typeof Schema.Json.Type> & {
  metadata: Record<string, typeof Schema.Json.Type>
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
  readonly savedMessages: Map<string, ManagedAssistantMessage>
  readonly nativeParts: Map<string, ManagedNativePart>
  readonly nativeUses: Map<string, typeof Schema.JsonObject.Type>
  web: typeof ChatWebEvidenceSchema.Type | undefined
  rawWeb: readonly (typeof Schema.JsonObject.Type)[] | undefined
  providerUsage: typeof Schema.JsonObject.Type | undefined
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
  const metadata = Schema.is(Schema.JsonObject)(part.metadata) ? part.metadata : undefined
  const provider = metadata?.providerExecuted === true
  const browser = !provider && tool !== undefined && !tool.execute
  const toolPartId = managedPartId(state.partIds, `tool:${nativeId}`)
  return {
    ...part,
    id: toolPartId,
    type: "tool-call",
    toolCallId: nativeId,
    ...(provider ? { providerTurnId: state.claim.inputMessageId } : {}),
    executionLocation: provider
      ? "provider"
      : browser
        ? "browser"
        : Schema.decodeUnknownSync(Schema.String)(part.name).startsWith("sandbox_")
          ? "sandbox"
          : "server_api",
    declaration: chatStoredJson({
      name: tool?.name ?? part.name,
      inputSchema: tool?.inputSchema ? convertSchemaToJsonSchema(tool.inputSchema) : undefined,
      outputSchema: tool?.outputSchema ? convertSchemaToJsonSchema(tool.outputSchema) : undefined,
    }),
    targets: provider
      ? []
      : [
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
  const models = structuredClone(
    messages.slice(state.phaseStart).filter((message) => message.role === "assistant"),
  )
  if (models.length === 0 && state.nativeParts.size)
    models.push({ id: state.claim.assistantMessageId, role: "assistant", content: "" })
  const first = models[0]
  if (first) {
    const missing = new Map(state.nativeParts)
    for (const message of models) {
      for (const call of message.toolCalls ?? []) {
        const native = state.nativeParts.get(call.id)
        if (native)
          call.metadata = {
            ...(call.metadata as Record<string, unknown> | undefined),
            ...native.metadata,
          }
        missing.delete(call.id)
      }
    }
    if (missing.size)
      first.toolCalls = [
        ...(first.toolCalls ?? []),
        ...[...missing].map(([id, part]) => ({
          id,
          type: "function" as const,
          function: {
            name: Schema.decodeUnknownSync(Schema.String)(part.name),
            arguments: Schema.decodeUnknownSync(Schema.String)(part.arguments ?? "{}"),
          },
          metadata: part.metadata,
        })),
      ]
    if (
      state.rawWeb?.length &&
      (options.model.api === "anthropic-messages" || options.model.providerType === "openrouter")
    )
      first.metadata = { ...first.metadata, astralbeamWeb: state.rawWeb }
  }
  const occurrences = new Map<string, number>()
  const occurrenceKey = (key: string) => {
    const count = occurrences.get(key) ?? 0
    occurrences.set(key, count + 1)
    return `${key}:${count}`
  }
  let textOffset = 0
  const parts = models
    .flatMap((model) => modelMessagesToUIMessages([model]))
    .flatMap((message) =>
      message.parts.map((part) => {
        const json = { ...chatStoredJson(part) }
        if (part.type === "tool-call") {
          const native = state.nativeParts.get(part.id)
          return managedToolPart(
            options,
            state,
            native
              ? {
                  ...json,
                  ...native,
                  metadata: {
                    ...(json.metadata as typeof Schema.JsonObject.Type),
                    ...(state.web
                      ? {
                          web:
                            part.id === state.nativeParts.keys().next().value
                              ? state.web
                              : { sources: [], citations: [] },
                        }
                      : {}),
                  },
                }
              : json,
          )
        }
        const key = `${part.type}:${"stepId" in part ? part.stepId : ""}`
        if (part.type === "text" && state.web) {
          const offset = textOffset
          textOffset += part.content.length
          const citations = state.web.citations
            .map((citation, index) => ({ ...citation, number: index + 1 }))
            .filter((citation) => citation.endIndex > offset && citation.endIndex <= textOffset)
            .map((citation) => ({
              ...citation,
              startIndex: Math.max(0, citation.startIndex - offset),
              endIndex: citation.endIndex - offset,
            }))
          json.metadata = {
            web: { sources: state.nativeParts.size ? [] : state.web.sources, citations },
          }
        }
        return { ...json, type: part.type, id: managedPartId(state.partIds, occurrenceKey(key)) }
      }),
    )
  return {
    version: 1,
    parts: parts.map(publicChatWebPart),
    modelMessages: (state.rawWeb?.length && options.model.api === "anthropic-messages" && first
      ? [
          {
            ...first,
            content: models
              .map((message) => (typeof message.content === "string" ? message.content : ""))
              .join(""),
            toolCalls: models.flatMap((message) => message.toolCalls ?? []),
          },
        ]
      : models
    ).map((message) =>
      chatStoredJson({
        ...message,
        ...(options.model.providerType === "openrouter"
          ? { toolCalls: message.toolCalls?.filter((call) => !state.nativeParts.has(call.id)) }
          : {}),
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
      ...(state.usage || state.providerUsage
        ? {
            usage: chatStoredJson({ ...state.usage, providerUsage: state.providerUsage }),
          }
        : {}),
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
        ...(message.role === "assistant"
          ? {
              metadata: {},
              ...(message.toolCalls
                ? { toolCalls: message.toolCalls.map((call) => ({ ...call, metadata: {} })) }
                : {}),
              parts: modelMessagesToUIMessages(
                convertMessagesToModelMessages([message as unknown as ModelMessage]),
              ).flatMap((ui) => ui.parts.map((part) => publicChatWebPart(chatStoredJson(part)))),
            }
          : {}),
        id:
          state.messageIds.get(message.id) ??
          (message.role === "assistant" ? state.claim.assistantMessageId : message.id),
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
    return {
      ...chunk,
      parentMessageId: state.claim.assistantMessageId,
      ...(chunk.metadata?.providerExecuted === true
        ? { metadata: { providerExecuted: true } }
        : {}),
    }
  }
  if (chunk.type === EventType.TOOL_CALL_END && chunk.metadata?.providerExecuted === true)
    return { ...chunk, metadata: { providerExecuted: true } }
  return chunk
}

function managedSavedChunk(state: ManagedChatStreamState, chunk: StreamChunk): StreamChunk {
  if (chunk.type !== EventType.MESSAGES_SNAPSHOT) return chunk
  const parts = state.payload.parts.map((part) =>
    part.type === "tool-call" && part.executionLocation !== "provider"
      ? {
          ...part,
          id: Schema.decodeUnknownSync(Schema.String)(part.toolCallId),
          applicationPartId: part.id,
        }
      : part,
  )
  const assistant = {
    id: state.claim.assistantMessageId,
    role: "assistant" as const,
    content: "",
    parts,
  }
  if (parts.length) state.savedMessages.set(assistant.id, assistant)
  settleChatWebActivity([...state.savedMessages.values()])
  const seen = new Set<string>()
  const messages = chunk.messages.flatMap((message) => {
    if (seen.has(message.id)) return []
    seen.add(message.id)
    return [state.savedMessages.get(message.id) ?? message]
  })
  if (parts.length && !seen.has(assistant.id)) messages.push(assistant)
  return { ...chunk, messages }
}

function bufferManagedWebSnapshot(
  state: ManagedChatStreamState,
  messages: readonly ModelMessage[],
) {
  if (!state.web || state.buffered.some((chunk) => chunk.type === EventType.MESSAGES_SNAPSHOT))
    return
  const terminal = state.buffered.findIndex((chunk) => chunk.type === EventType.RUN_FINISHED)
  state.buffered.splice(
    terminal === -1 ? state.buffered.length : terminal,
    0,
    managedPublicChunk(state, {
      type: EventType.MESSAGES_SNAPSHOT,
      timestamp: Date.now(),
      messages: messages as unknown as Extract<
        StreamChunk,
        { type: "MESSAGES_SNAPSHOT" }
      >["messages"],
    }),
  )
}

function observeManagedWebEvidence(
  options: ManagedChatStreamOptions,
  state: ManagedChatStreamState,
  value: unknown,
) {
  const evidence = Schema.decodeUnknownSync(Schema.JsonObject)(value)
  state.web = Schema.decodeUnknownSync(ChatWebEvidenceSchema)(evidence.web)
  state.rawWeb = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(evidence.raw)
  state.providerUsage = Schema.decodeUnknownSync(Schema.JsonObject)(evidence.providerUsage)
  // TanStack pairs server uses and results only within one request. Reconcile deferred calls.
  // https://github.com/TanStack/ai/blob/main/packages/ai-anthropic/src/adapters/text.ts
  for (const block of state.rawWeb)
    if (block.type === "server_tool_use" && typeof block.id === "string")
      state.nativeUses.set(block.id, block)
  state.rawWeb.forEach((block) => {
    const id = typeof block.tool_use_id === "string" ? block.tool_use_id : block.id
    if (typeof id !== "string") return
    const use = state.nativeUses.get(id)
    if (!use && block.type !== "web_search_call") return
    const previous = state.nativeParts.get(id)
    const content = Schema.is(Schema.JsonObject)(block.content) ? block.content : undefined
    const failed =
      block.status === "failed" ||
      (typeof content?.type === "string" && content.type.endsWith("_error"))
    state.nativeParts.set(id, {
      ...previous,
      id,
      name: use ? use.name! : "web_search",
      arguments: JSON.stringify(use ? (use.input ?? {}) : (block.action ?? {})),
      state: use
        ? typeof block.tool_use_id === "string"
          ? "complete"
          : (previous?.state ?? "input-complete")
        : block.status === "completed"
          ? "complete"
          : "input-complete",
      metadata: {
        ...previous?.metadata,
        providerExecuted: true,
        ...(failed ? { failed: true } : {}),
      },
    })
  })
  if (options.model.providerType === "openrouter") {
    const counts = Schema.is(Schema.JsonObject)(state.providerUsage.server_tool_use)
      ? state.providerUsage.server_tool_use
      : {}
    for (const name of ["web_search", "web_fetch"]) {
      const count = counts[`${name}_requests`]
      if (typeof count !== "number" || count <= 0) continue
      const id = `${state.claim.assistantMessageId}:${name}`
      state.nativeParts.set(id, {
        id,
        name,
        arguments: "{}",
        state: "complete",
        metadata: {
          providerExecuted: true,
          aggregate: true,
          requests: count,
          web: state.web,
        },
      })
    }
  }
}

function managedContextMessages(state: ManagedChatStreamState, messages: readonly ModelMessage[]) {
  for (const message of messages) {
    const blocks: unknown = message.metadata?.astralbeamWeb
    if (Schema.is(Schema.Array(Schema.JsonObject))(blocks))
      for (const block of blocks)
        if (block.type === "server_tool_use" && typeof block.id === "string")
          state.nativeUses.set(block.id, block)
    const meta: unknown = message.metadata?.astralbeam
    const logicalId =
      meta && typeof meta === "object" && "messageId" in meta ? meta.messageId : undefined
    if (message.id && typeof logicalId === "string") state.messageIds.set(message.id, logicalId)
  }
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
    savedMessages: new Map(options.publicHistory?.map((message) => [message.id, message])),
    nativeParts: new Map(),
    nativeUses: new Map(),
    web: undefined,
    rawWeb: undefined,
    providerUsage: undefined,
  }
  managedContextMessages(state, options.history)
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
    for (const [id, part] of state.nativeParts)
      if (part.state !== "complete")
        state.nativeParts.set(id, {
          ...part,
          metadata: { ...part.metadata, failed: true },
        })
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
      if (!config) return
      state.tools = config.tools
      managedContextMessages(state, config.providerMessages)
      for (const message of config.publicHistory ?? []) state.savedMessages.set(message.id, message)
      return {
        providerMessages: config.providerMessages,
        tools: config.tools,
        systemPrompts: config.systemPrompts,
      }
    },
    async onIteration(ctx, info) {
      if (state.phaseCount > 0) {
        bufferManagedWebSnapshot(state, ctx.messages)
        state.ready.push(
          ...state.buffered.splice(0).map((chunk) => managedSavedChunk(state, chunk)),
        )
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
      state.nativeParts.clear()
      state.web = undefined
      state.rawWeb = undefined
      state.providerUsage = undefined
      state.messageIds.set(info.messageId, state.claim.assistantMessageId)
    },
    onUsage(_ctx, usage) {
      state.usage = chatStoredJson(usage)
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
      if (chunk.type === EventType.CUSTOM && chunk.name === CHAT_WEB_EVIDENCE_EVENT) {
        observeManagedWebEvidence(options, state, chunk.value)
        return null
      }
      if (
        (chunk.type === EventType.TOOL_CALL_START || chunk.type === EventType.TOOL_CALL_END) &&
        (chunk.metadata?.providerExecuted === true || state.nativeParts.has(chunk.toolCallId))
      ) {
        const previous = state.nativeParts.get(chunk.toolCallId)
        state.nativeParts.set(chunk.toolCallId, {
          ...previous,
          id: chunk.toolCallId,
          ...(chunk.type === "TOOL_CALL_START"
            ? { name: chunk.toolCallName }
            : { arguments: JSON.stringify(chunk.input ?? {}), state: "complete" }),
          metadata: { ...previous?.metadata, ...chatStoredJson(chunk.metadata ?? {}) },
        })
      }
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
        bufferManagedWebSnapshot(state, ctx.messages)
        state.finished = true
      } catch (error) {
        state.failed = true
        throw error
      }
    },
    onError: checkpointInterrupted,
    onAbort: checkpointInterrupted,
  }
  return {
    state,
    middleware: [persistence, gates],
    observeWebEvidence: (value: unknown) => observeManagedWebEvidence(options, state, value),
  }
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
  for (const chunk of input.state.buffered) {
    yield managedSavedChunk(input.state, chunk)
  }
}
