import {
  ChatClient,
  type ChatClientState,
  type ConnectionAdapter,
  fetchServerSentEvents,
  type MultimodalContent,
  type UIMessage,
} from "@tanstack/ai-client"
import { EventType, type StreamChunk } from "@tanstack/ai/client"
import { DEFAULT_API_URL, DEFAULT_CHAT_AUTH_TOKEN_URL } from "../lib/constants.ts"
import {
  createChatThread,
  deleteChatThread,
  getChatAttachment,
  getChatConfig,
  getResolveChatToolResultUrl,
  getRunChatUrl,
  listChatThreads,
  updateChatThread,
  steerChatTurn,
} from "../api/generated/api.ts"
import {
  astralBeamChatFetch,
  isAstralBeamApiError,
  resolveApiUrl,
  type JwtOptions,
} from "../api/api.ts"
import { createDebugLogger } from "../lib/debug.ts"
import type { MountAstralBeamChatOptions } from "../lib/types.ts"
import { buildAgentTools, type WidgetDeclaration } from "./agent-tools.ts"
import {
  authenticationIdentity,
  authenticationState,
  type ChatAuthenticationState,
  createChatAuthentication,
  disposeChatAuthentication,
  fetchAuthenticatedChat,
  getValidChatAuthToken,
  subscribeAuthentication,
  updateAuthentication,
} from "./auth.ts"
import { startAuthentication } from "./auth-lifecycle.ts"
import { isSettledToolCall, hasPendingToolRun } from "./messages.ts"
import {
  loadPendingMessages,
  pendingMessageText,
  storePendingMessages,
  type PendingChatMessage,
} from "./pending-messages.ts"
import { ASK_QUESTIONNAIRE_TOOL, RENDER_WIDGET_TOOL, SANDBOX_STATUS_EVENT } from "./protocol.ts"
import { collectSandboxActivity } from "./sandbox.ts"
import { validateParameters } from "./schema.ts"
import type { RenderWidgetInput, SandboxActivity, SandboxStatus } from "./types.ts"
import {
  type ChatThread,
  type ChatPendingInteraction,
  type ChatToolCallPart,
  threadFromRecord,
  newUuid,
  loadThreadMessages,
  projectThreadMessages,
  savedToolCallId,
  selectedThread,
} from "./threads.ts"

/** A widget render the agent requested, handed to the host's `onRenderWidget`. */
export interface WidgetRenderRequest {
  widget: string
  props: Record<string, unknown>
  /** Keys the render: a repeat of the same call replaces its own render, not another's. */
  toolCallId: string
  /**
   * Drops this session's copy of the render's cleanup, for a host that disposed the render itself;
   * without it the cleanup — and the DOM it captures — is held until the next reset.
   */
  release: () => void
}

/**
 * Mirrors of the underlying chat client's stream lifecycle, for a consumer that logs or traces the
 * raw run; the drop-in widget passes its debug console logger here.
 */
export interface ChatStreamCallbacks {
  onChunk?: ((chunk: StreamChunk) => void) | undefined
  onResponse?: ((response?: Response) => void) | undefined
  onFinish?: ((message: UIMessage) => void) | undefined
  onError?: ((error: Error) => void) | undefined
}

export interface ChatSubmissionCallbacks {
  /** Identifies the conversation before its input is sent, including a newly created chat. */
  onThreadReady?: ((threadId: string) => void) | undefined
  /** Called once after the server acknowledges input, before generation finishes. */
  onAccepted?: (() => void) | undefined
  /** Called after input is retained locally for later delivery. */
  onQueued?: (() => void) | undefined
}

/**
 * The transport and tool options of the drop-in widget, minus everything about its UI, plus this
 * session's own rendering hooks. The shared options are documented on `MountAstralBeamChatOptions`.
 */
export interface AstralBeamChatCoreOptions extends Pick<
  MountAstralBeamChatOptions,
  "agentId" | "apiUrl" | "fetchAstralBeamToken" | "tools" | "debug" | "threadId"
> {
  /** Widgets declared to the agent, without a `render`; `onRenderWidget` is asked to draw them. */
  widgets?: Record<string, WidgetDeclaration> | undefined
  /** Draws an agent-requested widget however the host wants; may return a cleanup. */
  onRenderWidget?: ((request: WidgetRenderRequest) => (() => void) | void) | undefined
  /** Stream lifecycle callbacks, read per event so they follow an update. */
  streamCallbacks?: ChatStreamCallbacks | undefined
}

// Every option this session reads per request, so a consumer that watches option changes (the
// React hook) cannot forget one: a missing or unknown key fails the typecheck below.
export const CORE_OPTION_KEYS = Object.keys({
  agentId: true,
  threadId: true,
  apiUrl: true,
  fetchAstralBeamToken: true,
  tools: true,
  widgets: true,
  onRenderWidget: true,
  streamCallbacks: true,
  debug: true,
} satisfies Record<keyof AstralBeamChatCoreOptions, true>) as ReadonlyArray<
  keyof AstralBeamChatCoreOptions
>

/** One tool as declared to the agent: its name, and the `metadata.title` that labels it. */
export interface AgentToolInfo {
  name: string
  title: string | undefined
}

function sameAgentTools(
  current: readonly AgentToolInfo[],
  next: readonly AgentToolInfo[],
): boolean {
  return (
    current.length === next.length &&
    current.every(
      (tool, index) => tool.name === next[index]?.name && tool.title === next[index]?.title,
    )
  )
}

export interface AstralBeamChatState {
  messages: UIMessage[]
  /** The underlying chat client status: "ready", "submitted", "streaming", or "error". */
  status: ChatClientState
  error: Error | undefined
  auth: ChatAuthenticationState
  /** What the resolved agent grants; the UI should render only that. */
  capabilities: { attachments: boolean }
  /** The tool set currently declared to the agent, in declaration order. */
  agentTools: readonly AgentToolInfo[]
  sandboxStatus: SandboxStatus | undefined
  sandbox: SandboxActivity
  thread: ChatThread | undefined
  threadLoading: boolean
  threadLoadFailed: boolean
  messagesCursor: string | undefined
  olderMessagesLoading: boolean
  /** Retained until the server acknowledges the send, including after an uncertain network failure. */
  unsentMessage: string | MultimodalContent | undefined
  activeToolCallIds: readonly string[]
  pendingInteractions: readonly ChatPendingInteraction[]
  pendingMessages: readonly PendingChatMessage[]
  queuePaused: boolean
  activeTurnId: string | undefined
  activeTurnState: "running" | "waiting" | "completed" | "interrupted" | undefined
}

export interface AstralBeamChatCore {
  /** Start browser side effects after a React commit. Vanilla sessions start automatically. */
  start: () => void
  getState: () => AstralBeamChatState
  /** Notifies on every state change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /**
   * Merges option changes into the session and applies them in place, keeping the transcript and
   * the chat session. Only the keys given are replaced.
   */
  updateOptions: (options: Partial<AstralBeamChatCoreOptions>) => void
  /** Sends a message, persisting it before generation begins. */
  sendMessage: (
    content: string | MultimodalContent,
    callbacks?: ChatSubmissionCallbacks,
    options?: { whenBusy: "queue" | "steer" },
  ) => Promise<void>
  editPendingMessage: (id: string, content: string | MultimodalContent) => boolean
  removePendingMessage: (id: string) => void
  steerPendingMessage: (id: string) => Promise<void>
  resumeQueue: () => Promise<void>
  /** Holds automatic delivery while editing. Release on save, cancel, or unmount. */
  holdQueue: () => () => void
  /** Resolves a client tool call the host executed itself (a questionnaire, an approval). */
  addToolResult: ChatClient["addToolResult"]
  /** Stops the in-flight generation; the transcript keeps what already streamed. */
  stop: () => void
  /** Mints a fresh chat auth token, ignoring the cached one; for a retry after a failure. */
  retryAuthentication: () => void
  /** Refreshes saved history and retries delivery of retained tool results. */
  reload: () => Promise<void>
  /** Starts an empty conversation and disposes widget renders, preserving any saved chat. */
  reset: () => void
  /** Searches all authorized conversation titles using server pagination. */
  searchThreads: (
    q?: string,
    cursor?: string,
    signal?: AbortSignal,
  ) => Promise<{ items: ChatThread[]; page_after: string | null }>
  /** Loads saved history before accepting another send. */
  openThread: (id: string) => Promise<void>
  renameThread: (title: string) => Promise<boolean>
  /** Deletes a listed conversation, the selected one by default; resolves whether it succeeded. */
  deleteThread: (thread?: ChatThread) => Promise<boolean>
  refreshThread: () => Promise<void>
  loadOlderMessages: () => Promise<void>
  abandonToolCall: (toolCallId: string) => Promise<void>
  getAttachment: (messageId: string, partId: string) => Promise<Blob>
  /** Tears the session down: the connection, authentication, and widget renders. */
  dispose: () => void
}

/**
 * The headless AstralBeam chat session: authentication, transport, the tool protocol, and
 * transcript state, with no markup. The drop-in widget is one consumer; a host that owns its
 * whole UI is another.
 */
export function createAstralBeamChat(
  options: AstralBeamChatCoreOptions,
  deferStart = false,
): AstralBeamChatCore {
  let live: AstralBeamChatCoreOptions = { ...options }
  let debug = createDebugLogger(live.debug)
  const listeners = new Set<() => void>()
  let state: AstralBeamChatState = {
    messages: [],
    status: "ready",
    error: undefined,
    auth: { status: "loading" },
    capabilities: { attachments: true },
    agentTools: [],
    sandboxStatus: undefined,
    sandbox: { files: [], commands: [] },
    thread: undefined,
    threadLoading: false,
    threadLoadFailed: false,
    messagesCursor: undefined,
    olderMessagesLoading: false,
    unsentMessage: undefined,
    activeToolCallIds: [],
    pendingInteractions: [],
    pendingMessages: [],
    queuePaused: false,
    activeTurnId: undefined,
    activeTurnState: undefined,
  }
  const update = (next: Partial<AstralBeamChatState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  const authentication = createChatAuthentication({
    apiUrl: live.apiUrl,
    scope: "tenant",
    fetchAstralBeamToken: live.fetchAstralBeamToken ?? { url: DEFAULT_CHAT_AUTH_TOKEN_URL },
  })
  let stopAuthentication: (() => void) | undefined
  let unsubscribeAuthentication: (() => void) | undefined
  let identity: string | undefined
  let started = false
  let selectionGeneration = 0
  let navigationGeneration = 0
  let historyGeneration = 0
  let hydration: Promise<unknown> = Promise.resolve()
  let requestController = new AbortController()
  let threadKey: string | undefined
  let startWithNewThread = false
  let threadRecords: Awaited<ReturnType<typeof loadThreadMessages>>["messages"] = []
  let clientId = newUuid()
  let queueThreadId: string | undefined
  let pendingMessages: PendingChatMessage[] = []
  const messageQueues = new Map<string, PendingChatMessage[]>()
  const pendingCallbacks = new Map<string, ChatSubmissionCallbacks>()
  const queueKey = (id = queueThreadId) =>
    threadKey ? `${threadKey}:pending:${id ?? "new"}` : undefined
  const publishQueue = () => {
    const key = queueKey()
    if (key) messageQueues.set(key, pendingMessages)
    storePendingMessages(key, pendingMessages)
    update({ pendingMessages: [...pendingMessages] })
  }
  const restoreQueue = (id?: string) => {
    queueThreadId = id
    const key = queueKey()
    pendingMessages = key ? (messageQueues.get(key) ?? loadPendingMessages(key)) : []
    update({ pendingMessages: [...pendingMessages], queuePaused: true })
  }
  let pendingSend:
    | {
        content: string | MultimodalContent
        accepted: boolean
        key: string
        tools?: Array<Record<string, unknown>> | undefined
        callbacks?: ChatSubmissionCallbacks | undefined
      }
    | undefined
  let sending = false
  let liveTurn = false
  const pendingSends = new Map<string, NonNullable<typeof pendingSend>>()
  const acceptPendingSend = () => {
    const submission = pendingSend
    if (!submission || submission.accepted) return
    submission.accepted = true
    pendingMessages = pendingMessages.filter((entry) => entry.id !== submission.key)
    pendingCallbacks.delete(submission.key)
    publishQueue()
    if (state.thread) update({ thread: { ...state.thread, hasMessages: true } })
    submission.callbacks?.onAccepted?.()
  }
  const liveToolCalls = new Set<string>()
  const liveToolMessageIds = new Map<string, string>()
  const historicalToolIds = new Map<string, Map<string, string>>()
  type ToolResult = { outcome: "succeeded" | "failed" | "skipped" | "unknown"; output: unknown }
  let toolResults = new Map<string, ToolResult>()
  const threadToolResults = new Map<string, typeof toolResults>()
  const toolResultKey = (id: string) => {
    const messageId = liveToolMessageIds.get(id)
    return messageId ? `live:${messageId}:${id}` : id
  }
  const retainToolResults = (history: Awaited<ReturnType<typeof loadThreadMessages>>) => {
    const retained: typeof toolResults = new Map()
    for (const pending of history.pending_interactions) {
      const nativeKey = `live:${pending.source_message_id}:${pending.tool_call_id}`
      const savedKey = savedToolCallId(
        pending.source_message_id,
        pending.source_part_id,
        pending.response_target_id,
      )
      const result = toolResults.get(nativeKey) ?? toolResults.get(savedKey)
      if (!result) continue
      retained.set(savedKey, result)
      if (liveToolMessageIds.get(pending.tool_call_id) === pending.source_message_id)
        retained.set(nativeKey, result)
    }
    toolResults.clear()
    for (const [id, result] of retained) toolResults.set(id, result)
  }

  const reportError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return
    const failure = error instanceof Error ? error : new Error(String(error))
    liveTurn = false
    update({ error: failure, status: "error", queuePaused: true })
    live.streamCallbacks?.onError?.(failure)
  }
  const requestOptions = async (): Promise<JwtOptions> => {
    const generation = selectionGeneration
    const token = await getValidChatAuthToken(authentication)
    if (generation !== selectionGeneration)
      throw new DOMException("Conversation changed", "AbortError")
    return {
      apiUrl: authentication.apiUrl,
      astralBeamToken: token,
      cache: "no-store",
      signal: AbortSignal.any([
        requestController.signal,
        authentication.session.abortController.signal,
      ]),
      fetchClient: (input, init) => fetchAuthenticatedChat({ ...authentication, input, init }),
    }
  }

  // Agent capability handshake; fails open for state (the endpoint still enforces its policy).
  // Generation-checked, so a slower response for a superseded agent or API base is dropped
  // instead of overwriting the grant resolved for the current one.
  let capabilitiesGeneration = 0
  let capabilityIdentity: string | undefined
  const resolveCapabilities = async () => {
    const generation = ++capabilitiesGeneration
    const selection = selectionGeneration
    if (state.thread?.agentId === null) {
      update({ capabilities: { attachments: false } })
      return
    }
    const agentId = state.thread ? state.thread.agentId : live.agentId
    try {
      const auth = await requestOptions()
      if (generation !== capabilitiesGeneration || selection !== selectionGeneration) return
      const body = await getChatConfig(agentId ? { agentId } : {}, auth)
      if (generation !== capabilitiesGeneration || selection !== selectionGeneration) return
      const attachments = body.capabilities?.attachments !== false
      update({ capabilities: { attachments } })
      debug?.("mount", "agent capabilities resolved", { attachments })
    } catch (error) {
      debug?.("error", "agent capabilities could not be resolved; keeping the defaults", error)
    }
  }

  // Live widget renders, keyed per tool call like the styled widget's, so a repeated call
  // replaces its own render and a reset disposes them all.
  const renderCleanups = new Map<string, () => void>()
  const restoredWidgets = new Set<string>()
  const restoringWidgets = new Set<string>()
  const disposeRenders = () => {
    for (const cleanup of renderCleanups.values()) cleanup()
    renderCleanups.clear()
    restoredWidgets.clear()
    restoringWidgets.clear()
  }
  const renderWidget = async (
    input: RenderWidgetInput,
    toolCallId: string,
  ): Promise<{ widget: string; rendered: boolean }> => {
    const generation = selectionGeneration
    const widgets = live.widgets ?? {}
    if (!Object.hasOwn(widgets, input.widget)) {
      throw new Error(`Unknown widget "${input.widget}"`)
    }
    const declaration = widgets[input.widget]
    const validated = await validateParameters(declaration?.parameters, input.props ?? {})
    if (generation !== selectionGeneration || state.thread?.role === "viewer")
      return { widget: input.widget, rendered: false }
    if (declaration !== live.widgets?.[input.widget]) return renderWidget(input, toolCallId)
    if (validated == null) {
      throw new Error(`Props for widget "${input.widget}" failed validation`)
    }
    const onRenderWidget = live.onRenderWidget
    if (!onRenderWidget) return { widget: input.widget, rendered: false }
    renderCleanups.get(toolCallId)?.()
    renderCleanups.delete(toolCallId)
    // Compared by identity, so a late release cannot forget the cleanup of a newer render that
    // has meanwhile taken over the same tool call.
    let registered: (() => void) | undefined
    const release = () => {
      if (renderCleanups.get(toolCallId) === registered) renderCleanups.delete(toolCallId)
    }
    const cleanup = onRenderWidget({
      widget: input.widget,
      props: validated,
      toolCallId,
      release,
    })
    if (cleanup) {
      registered = cleanup
      renderCleanups.set(toolCallId, cleanup)
    }
    restoredWidgets.add(toolCallId)
    return { widget: input.widget, rendered: true }
  }

  const restoreCompletedWidgets = (messages: readonly UIMessage[]) => {
    if (state.thread?.role === "viewer") return
    const renderIds = new Map<string, string>()
    for (const message of state.messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || part.name !== RENDER_WIDGET_TOOL) continue
        const stored = part as ChatToolCallPart
        if (!stored.widgetRenderId) continue
        renderIds.set(savedToolCallId(message.id, part.id), stored.widgetRenderId)
        if (stored.applicationPartId)
          renderIds.set(
            savedToolCallId(message.id, stored.applicationPartId, stored.responseTargetId),
            stored.widgetRenderId,
          )
      }
    }
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type !== "tool-call" ||
          part.name !== RENDER_WIDGET_TOOL ||
          part.state !== "complete" ||
          !part.input
        )
          continue
        const stored = part as ChatToolCallPart
        const upstream = stored.upstreamToolCallId
        const renderId =
          stored.widgetRenderId ??
          renderIds.get(savedToolCallId(message.id, part.id)) ??
          (stored.applicationPartId
            ? renderIds.get(
                savedToolCallId(message.id, stored.applicationPartId, stored.responseTargetId),
              )
            : undefined) ??
          (upstream &&
          liveToolMessageIds.get(upstream) === message.id &&
          restoredWidgets.has(upstream)
            ? upstream
            : part.id)
        stored.widgetRenderId = renderId
        if (restoredWidgets.has(renderId) || restoringWidgets.has(renderId)) continue
        restoringWidgets.add(renderId)
        const generation = selectionGeneration
        const { widgets, onRenderWidget } = live
        void renderWidget(part.input as RenderWidgetInput, renderId)
          .catch((error: unknown) => debug?.("error", "Saved widget could not be rendered", error))
          .finally(() => {
            if (generation !== selectionGeneration) return
            restoringWidgets.delete(renderId)
            if (widgets !== live.widgets || onRenderWidget !== live.onRenderWidget)
              restoreCompletedWidgets(state.messages)
          })
      }
    }
  }

  const buildTools = () =>
    buildAgentTools(live.widgets ?? {}, live.tools ?? {}, renderWidget, debug).map((tool) => {
      if (!tool.execute) return tool
      const execute = tool.execute
      return {
        ...tool,
        execute: async (
          input: Parameters<typeof execute>[0],
          context: Parameters<typeof execute>[1],
        ) => {
          const toolCallId = context?.toolCallId
          if (!toolCallId || !liveToolCalls.has(toolCallId)) {
            throw new Error(
              "A saved tool call cannot execute again. Send a new message to request it.",
            )
          }
          const results = toolResults
          const key = toolResultKey(toolCallId)
          const resultIdentity = identity
          const apiUrl = authentication.apiUrl
          try {
            const output: unknown = await execute(input, context)
            if (identity === resultIdentity && authentication.apiUrl === apiUrl)
              results.set(key, {
                outcome: "succeeded",
                output: output ?? null,
              })
            return output
          } catch (error) {
            if (identity === resultIdentity && authentication.apiUrl === apiUrl)
              results.set(key, {
                outcome: "unknown",
                output: { error: error instanceof Error ? error.message : String(error) },
              })
            throw error
          }
        },
      }
    })
  // Published as state so a UI can label a tool's transcript entry with its own title, including
  // the widget and questionnaire tools this session declares itself.
  const declareTools = () => {
    const tools = buildTools()
    const agentTools = tools.map((tool) => {
      const title = tool.metadata?.["title"]
      return {
        name: tool.name,
        title: typeof title === "string" && title.length > 0 ? title : undefined,
      }
    })
    // Compared by value: a host that rebuilds equivalent tool objects every render would
    // otherwise be notified of a change that then feeds its own update back in, forever.
    if (!sameAgentTools(state.agentTools, agentTools)) update({ agentTools })
    return tools
  }
  const forwardedProps = () => (live.debug ? { debug: true } : {})

  const threadRequest = async (init: RequestInit, auth: JwtOptions): Promise<Response> => {
    const thread = state.thread
    if (!thread || typeof init.body !== "string")
      throw new Error("Open a conversation before sending.")
    const generation = selectionGeneration
    const body = JSON.parse(init.body) as {
      messages: Array<{ role: string; toolCallId?: string }>
      tools: Array<Record<string, unknown>>
      forwardedProps?: Record<string, unknown>
      runId: string
      parentRunId?: string
    }
    let path = getRunChatUrl()
    let payload: unknown
    const submission = body.messages.at(-1)?.role === "user" ? pendingSend : undefined
    const previouslyAttempted = submission?.tools !== undefined
    if (submission) {
      payload = {
        ...body,
        threadId: thread.id,
        resume: undefined,
        parentRunId: undefined,
        messages: [body.messages.at(-1)],
        tools: (submission.tools ??= body.tools),
        forwardedProps: {
          ...body.forwardedProps,
          clientId,
        },
      }
      const queued = pendingMessages.find((entry) => entry.id === submission.key)
      if (queued) {
        queued.tools = submission.tools
        publishQueue()
      }
    } else {
      scopeCompletedToolCalls()
      const history = await loadThreadMessages(thread.id, auth, undefined, liveToolMessageIds)
      if (generation !== selectionGeneration)
        throw new DOMException("Conversation changed", "AbortError")
      update({
        thread: threadFromRecord(history.thread, history.messages.length > 0),
      })
      retainToolResults(history)
      const available = history.pendingInteractions.filter((pending) =>
        toolResults.has(toolResultKey(pending.toolCallId)),
      )
      const source =
        available.find((pending) => pending.toolCallId === body.messages.at(-1)?.toolCallId) ??
        available[0]
      const results = history.pendingInteractions.flatMap((pending) => {
        const submitted = toolResults.get(toolResultKey(pending.toolCallId))
        return submitted && pending.sourceMessageId === source?.sourceMessageId
          ? [
              {
                source_message_id: pending.sourceMessageId,
                source_part_id: pending.sourcePartId,
                response_target_id: pending.responseTargetId,
                ...submitted,
              },
            ]
          : []
      })
      if (results.length === 0)
        return new Response("", { headers: { "Content-Type": "text/event-stream" } })
      path = getResolveChatToolResultUrl(thread.id)
      payload = {
        client_id: clientId,
        run_id: body.runId,
        ...(body.parentRunId ? { parent_run_id: body.parentRunId } : {}),
        results,
      }
    }
    liveToolCalls.clear()
    update({ activeToolCallIds: [] })
    const headers = new Headers(init.headers)
    if (submission) headers.set("Idempotency-Key", submission.key)
    const response = await astralBeamChatFetch(path, {
      ...auth,
      ...init,
      headers,
      body: JSON.stringify(payload),
    }).catch((error: unknown) => {
      if (
        submission &&
        !previouslyAttempted &&
        isAstralBeamApiError(error) &&
        (error.status === 400 || error.status === 413 || error.status === 429)
      ) {
        delete submission.tools
        const queued = pendingMessages.find((entry) => entry.id === submission.key)
        if (queued) {
          delete queued.tools
          queued.status = "queued"
        }
        publishQueue()
      }
      throw error
    })
    if (generation !== selectionGeneration)
      throw new DOMException("Conversation changed", "AbortError")
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const receipt = (await response.json()) as { thread_version: number }
      if (generation !== selectionGeneration)
        throw new DOMException("Conversation changed", "AbortError")
      update({
        thread: { ...state.thread!, version: receipt.thread_version },
      })
      if (submission) {
        liveTurn = false
        acceptPendingSend()
      }
      return new Response("", { headers: { "Content-Type": "text/event-stream" } })
    }
    return response
  }

  // Read the live API base for each request without recreating the conversation.
  const connection = fetchServerSentEvents(
    () => resolveApiUrl(getRunChatUrl(), authentication.apiUrl),
    async () => {
      const previousIdentity = identity
      const token = await getValidChatAuthToken(authentication)
      if (previousIdentity !== undefined && previousIdentity !== identity) {
        throw new DOMException("Identity changed", "AbortError")
      }
      return {
        fetchClient: (_input, init) => {
          const auth: JwtOptions = {
            apiUrl: authentication.apiUrl,
            astralBeamToken: token,
            ...(init?.signal ? { signal: init.signal } : {}),
            cache: "no-store",
            fetchClient: (input, request) =>
              fetchAuthenticatedChat({ ...authentication, input, init: request }),
          }
          return threadRequest(init ?? {}, auth)
        },
      }
    },
  )
  const connect = connection.connect
  // Unwrap before ChatClient converts thrown errors into RUN_ERROR messages.
  connection.connect = async function* (...args) {
    try {
      for await (const chunk of connect(...args)) {
        if (chunk.type === EventType.TOOL_CALL_START && chunk.parentMessageId)
          liveToolMessageIds.set(chunk.toolCallId, chunk.parentMessageId)
        if (chunk.type !== EventType.MESSAGES_SNAPSHOT) {
          yield chunk
          continue
        }
        let aliases: Map<string, string> | undefined
        yield {
          ...chunk,
          messages: chunk.messages.map((message) => {
            if (message.role === "assistant") {
              aliases = historicalToolIds.get(message.id)
              return aliases && message.toolCalls
                ? {
                    ...message,
                    toolCalls: message.toolCalls.map((call) => ({
                      ...call,
                      id: aliases?.get(call.id) ?? call.id,
                    })),
                  }
                : message
            }
            if (message.role === "tool")
              return {
                ...message,
                toolCallId: aliases?.get(message.toolCallId) ?? message.toolCallId,
              }
            aliases = undefined
            return message
          }),
        }
      }
    } catch (error) {
      throw error instanceof Error && isAstralBeamApiError(error.cause) ? error.cause : error
    }
  }
  // The thread ID is fixed per client and keys the server's sandbox lease, so a new conversation
  // gets a new client instead of `clear()`. A replaced client's late callbacks are dropped.
  const createClient = (threadId = state.thread?.id): ChatClient => {
    const generation = selectionGeneration
    const adapter: ConnectionAdapter = {
      ...connection,
    }
    // Local empty chats have no saved resource for native hydration.
    // Saved threads use the authorized REST hydration below.
    delete adapter.hydrate
    if (threadId)
      adapter.hydrate = (_id, options) => {
        const readGeneration = ++historyGeneration
        if (!options?.before) update({ threadLoading: true })
        const read = (async () => {
          let history = await loadThreadMessages(
            threadId,
            await requestOptions(),
            options?.before,
            liveToolMessageIds,
          )
          // Result rows can straddle pages. Join them with their decision before projecting
          // the older UI window, while ChatClient owns prepending and pagination state.
          while (
            options?.before &&
            history.messages.every((message) => message.role === "tool") &&
            history.page_after
          ) {
            const earlier = await loadThreadMessages(
              threadId,
              await requestOptions(),
              history.page_after,
              liveToolMessageIds,
            )
            history = { ...earlier, messages: [...earlier.messages, ...history.messages] }
          }
          if (generation !== selectionGeneration || readGeneration !== historyGeneration)
            throw new DOMException("Conversation changed", "AbortError")
          retainToolResults(history)
          threadRecords = options?.before
            ? [...history.messages, ...threadRecords]
            : history.messages
          const pageIds = new Set(history.messages.map((message) => message.id))
          const messages = projectThreadMessages(
            threadRecords,
            history.pendingInteractions,
            liveToolMessageIds,
          ).filter((message) => pageIds.has(message.id))
          if (history.thread.role === "viewer") disposeRenders()
          const agentChanged = state.thread?.agentId !== history.thread.agent_id
          pendingMessages = pendingMessages.filter(
            (entry) =>
              !entry.acceptedMessageId ||
              !history.messages.some((message) => message.id === entry.acceptedMessageId),
          )
          publishQueue()
          const ownTurn = history.messages.findLast(
            (message) =>
              message.role === "user" &&
              message.turn_message_id === null &&
              message.author_tenant_user_id ===
                (state.auth.status === "ready" ? state.auth.currentUser.user.id : undefined),
          )
          update({
            thread: threadFromRecord(history.thread, history.messages.length > 0),
            messagesCursor: history.page_after ?? undefined,
            pendingInteractions: history.pendingInteractions,
            threadLoadFailed: false,
            ...(!options?.before && ownTurn
              ? { activeTurnId: ownTurn.id, activeTurnState: ownTurn.turn_state ?? undefined }
              : {}),
          })
          restoreCompletedWidgets(messages)
          if (!options?.before && agentChanged) void resolveCapabilities()
          // TanStack leaves local messages unchanged for an empty hydration page.
          // An empty saved thread must remove rejected optimistic input.
          if (!options?.before && messages.length === 0) next.setMessagesManually([])
          // Foreground execution has no replay stream to join. Pending interactions remain
          // application-owned because several turns can wait independently in one thread.
          return {
            messages,
            activeRun: null,
            interrupts: null,
            page: history.page_after
              ? { truncated: true as const, cursor: history.page_after }
              : { truncated: false as const },
          }
        })()
        if (!options?.before) {
          hydration = read
          // Complete loading after ChatClient applies the page, including hydration on React remount.
          const settled = (failed: boolean) =>
            queueMicrotask(() => {
              if (generation === selectionGeneration && readGeneration === historyGeneration) {
                update({ threadLoading: false, threadLoadFailed: failed })
                if (!failed) void drainQueue()
              }
            })
          void read.then(
            () => settled(false),
            () => settled(true),
          )
        }
        return read
      }
    const next: ChatClient = new ChatClient({
      connection: adapter,
      // An empty local view uses its client ID until a stored thread is created before sending.
      threadId: threadId ?? clientId,
      persistence: true,
      history: { pageSize: 100 },
      queue: "drop",
      tools: declareTools(),
      forwardedProps: forwardedProps(),
      onMessagesChange: (messages) => {
        if (client !== next || generation !== selectionGeneration) return
        // Model snapshots omit client render IDs. Retain the existing slot before publishing them.
        restoreCompletedWidgets(messages)
        update({ messages, sandbox: collectSandboxActivity(messages), error: next.getError() })
      },
      onStatusChange: (status) => {
        if (client === next && generation === selectionGeneration)
          update({ status, error: next.getError() })
      },
      onInterruptStateChange: (interrupts) => {
        if (client === next) debug?.("tool", "interrupt state changed", interrupts)
      },
      onCustomEvent: (eventType, data) => {
        if (client !== next) return
        if (eventType === "astralbeam_thread") {
          const event = data as {
            threadId: string
            version: number
            saved?: boolean
            acceptedMessageId?: string
            executableToolCallIds?: string[]
            turnMessageId?: string
            turnState?: AstralBeamChatState["activeTurnState"]
            appliedSteeringMessageIds?: string[]
          }
          if (state.thread?.id === event.threadId) {
            if (event.appliedSteeringMessageIds?.length) {
              pendingMessages = pendingMessages.filter(
                (entry) =>
                  !entry.acceptedMessageId ||
                  !event.appliedSteeringMessageIds!.includes(entry.acceptedMessageId),
              )
              publishQueue()
            }
            if (event.acceptedMessageId) acceptPendingSend()
            if (event.saved)
              for (const id of event.executableToolCallIds ?? []) {
                if (!liveToolCalls.has(id)) toolResults.delete(toolResultKey(id))
                liveToolCalls.add(id)
              }
            update({
              thread: {
                ...state.thread,
                version: Math.max(state.thread.version, event.version ?? state.thread.version),
              },
              activeToolCallIds: [...liveToolCalls],
              ...(event.acceptedMessageId ? { unsentMessage: undefined } : {}),
              ...(event.turnMessageId
                ? { activeTurnId: event.turnMessageId, activeTurnState: event.turnState }
                : {}),
            })
            if (event.turnState === "completed" || event.turnState === "interrupted")
              liveTurn = false
          }
          return
        }
        const value = (data as { state?: unknown } | undefined)?.state
        if (
          eventType === SANDBOX_STATUS_EVENT &&
          (value === "starting" || value === "ready" || value === "error")
        ) {
          debug?.("sandbox", `sandbox ${value}`)
          update({ sandboxStatus: value })
          return
        }
        debug?.("stream", `custom event "${eventType}"`, data)
      },
      // Read per event rather than captured, so a `debug` update reaches the next chunk.
      onChunk: (chunk) => {
        if (client !== next) return
        live.streamCallbacks?.onChunk?.(chunk)
      },
      onResponse: (response) => {
        if (client === next) live.streamCallbacks?.onResponse?.(response)
      },
      onFinish: (message) => {
        if (client === next) live.streamCallbacks?.onFinish?.(message)
      },
      onError: (error) => {
        if (client === next) live.streamCallbacks?.onError?.(error)
      },
    })
    return next
  }
  let client = createClient()
  const replaceClient = (threadId = state.thread?.id) => {
    client.stop()
    const previous = client
    previous.detach()
    liveToolCalls.clear()
    liveToolMessageIds.clear()
    update({ activeToolCallIds: [] })
    client = createClient(threadId)
    if (started) client.attach()
    previous.dispose()
  }

  // Hydrated tool IDs identify one stored target. Native stream IDs remain unchanged
  // while their originating client's interrupt bindings are active.
  const scopeCompletedToolCalls = () => {
    historicalToolIds.clear()
    client.setMessagesManually(
      state.messages.map((message) => {
        const aliases = new Map<string, string>()
        const parts = message.parts.map((part) => {
          if (part.type !== "tool-call") return part
          const stored = part as ChatToolCallPart
          const upstreamToolCallId = stored.upstreamToolCallId ?? part.id
          if (liveToolMessageIds.get(upstreamToolCallId) === message.id && !isSettledToolCall(part))
            return part
          const id = savedToolCallId(
            message.id,
            stored.applicationPartId ?? upstreamToolCallId,
            stored.responseTargetId,
          )
          aliases.set(upstreamToolCallId, id)
          return {
            ...part,
            upstreamToolCallId,
            id,
            ...(part.name === RENDER_WIDGET_TOOL &&
            liveToolMessageIds.get(upstreamToolCallId) === message.id
              ? { widgetRenderId: stored.widgetRenderId ?? part.id }
              : {}),
          }
        })
        if (aliases.size) historicalToolIds.set(message.id, aliases)
        return { ...message, parts }
      }),
    )
  }

  const changeSelection = (threadId?: string) => {
    publishQueue()
    liveTurn = false
    const previousId = state.thread?.id
    if (previousId) {
      if (pendingSend && !pendingSend.accepted) pendingSends.set(previousId, pendingSend)
      else pendingSends.delete(previousId)
      threadToolResults.set(previousId, toolResults)
    }
    selectionGeneration++
    historyGeneration++
    sending = false
    requestController.abort()
    requestController = new AbortController()
    pendingSend = undefined
    toolResults = threadToolResults.get(threadId ?? "") ?? new Map<string, ToolResult>()
    historicalToolIds.clear()
    threadRecords = []
    disposeRenders()
    update({
      thread: undefined,
      messages: [],
      unsentMessage: undefined,
      error: undefined,
      status: "ready",
      sandbox: { files: [], commands: [] },
      sandboxStatus: undefined,
      pendingInteractions: [],
      activeTurnId: undefined,
      activeTurnState: undefined,
      threadLoadFailed: false,
      messagesCursor: undefined,
      olderMessagesLoading: false,
    })
    replaceClient(threadId)
    restoreQueue(threadId)
  }

  const openThread = async (id: string, restoring = false) => {
    if (!restoring) navigationGeneration++
    changeSelection(id)
    const generation = selectionGeneration
    update({ threadLoading: true })
    try {
      pendingSend = pendingSends.get(id)
      update({ unsentMessage: pendingSend?.content })
      if (!started) client.attach()
      await hydration
      if (generation !== selectionGeneration) return
      if (threadKey) selectedThread(threadKey, id)
    } catch (error) {
      if (generation === selectionGeneration) {
        if (
          restoring &&
          (live.threadId === undefined || live.threadId === "auto") &&
          isAstralBeamApiError(error) &&
          error.status === 404
        ) {
          newThread()
          return
        }
        update({ threadLoadFailed: true })
        reportError(error)
      }
    } finally {
      if (generation === selectionGeneration) update({ threadLoading: false })
    }
  }

  const newThread = () => {
    navigationGeneration++
    changeSelection()
    update({ threadLoading: false })
    if (started) void resolveCapabilities()
    if (threadKey) selectedThread(threadKey, null)
    else startWithNewThread = true
  }

  const selectConfiguredThread = (restoring = false) => {
    let selected = live.threadId
    if (selected === undefined || selected === "auto") {
      if (!threadKey) return
      selected = selectedThread(threadKey)
    }
    if (selected && selected !== "new") void openThread(selected, restoring)
    else if (!restoring) newThread()
  }

  const ensureThread = async () => {
    if (state.thread) return
    const generation = selectionGeneration
    const options = await requestOptions()
    const record = await createChatThread(live.agentId ? { agent_id: live.agentId } : {}, options)
    if (generation !== selectionGeneration)
      throw new DOMException("Conversation changed", "AbortError")
    const thread = threadFromRecord(record, false)
    const oldKey = queueKey()
    queueThreadId = thread.id
    if (oldKey) {
      messageQueues.delete(oldKey)
      storePendingMessages(oldKey, [])
    }
    publishQueue()
    update({ thread })
    replaceClient()
    await hydration
    void resolveCapabilities()
    if (threadKey) selectedThread(threadKey, thread.id)
  }

  const refreshThread = async (preserveError = false, resetClient = true) => {
    const id = state.thread?.id
    if (!id) return
    const generation = selectionGeneration
    const previousError = state.error
    update({ threadLoading: true, olderMessagesLoading: false })
    try {
      if (resetClient) replaceClient()
      else {
        client.detach()
        client.attach()
      }
      await hydration
      if (generation !== selectionGeneration) return
      if (preserveError && previousError) update({ error: previousError, status: "error" })
    } catch (error) {
      if (generation === selectionGeneration) {
        if (isAstralBeamApiError(error) && error.status === 404) {
          newThread()
          return
        }
        reportError(error)
      }
    } finally {
      if (generation === selectionGeneration) update({ threadLoading: false })
    }
  }

  const loadOlderMessages = async () => {
    if (
      !client.getHasOlderMessages() ||
      state.olderMessagesLoading ||
      state.threadLoading ||
      sending
    )
      return
    const generation = selectionGeneration
    update({ olderMessagesLoading: true })
    try {
      await client.loadOlderMessages()
    } catch (error) {
      if (generation === selectionGeneration) reportError(error)
    } finally {
      if (generation === selectionGeneration) update({ olderMessagesLoading: false })
    }
  }

  const renameThread = async (title: string) => {
    const thread = state.thread
    if (!thread || thread.role !== "manager") return false
    const generation = selectionGeneration
    try {
      const record = await updateChatThread(
        thread.id,
        { title, expected_version: thread.version },
        await requestOptions(),
      )
      if (generation !== selectionGeneration) return false
      const renamed = threadFromRecord(record, thread.hasMessages)
      update({ thread: renamed, error: client.getError(), status: client.getStatus() })
      return true
    } catch (error) {
      if (generation === selectionGeneration) reportError(error)
      return false
    }
  }

  const deleteThread = async (thread = state.thread) => {
    if (!thread || thread.role !== "manager") return false
    const generation = selectionGeneration
    try {
      await deleteChatThread(
        thread.id,
        { expected_version: String(thread.version) },
        await requestOptions(),
      )
      if (generation === selectionGeneration && state.thread?.id === thread.id) newThread()
      return true
    } catch (error) {
      if (generation === selectionGeneration) reportError(error)
      return false
    }
  }

  const addToolResult = async (
    result: Parameters<ChatClient["addToolResult"]>[0] | { toolCallId: string },
  ) => {
    const generation = selectionGeneration
    if (sending || client.getIsLoading()) {
      reportError(new Error("Wait for this client's current request to finish before responding."))
      return
    }
    const current = authenticationState(authentication)
    const pending = state.pendingInteractions.find((item) => item.toolCallId === result.toolCallId)
    const closure =
      !("tool" in result) &&
      pending &&
      (state.thread?.role === "manager" ||
        (current.status === "ready" && pending.targetTenantUserId === current.currentUser.user.id))
    const questionnaire =
      "tool" in result &&
      result.tool === ASK_QUESTIONNAIRE_TOOL &&
      current.status === "ready" &&
      pending?.targetTenantUserId === current.currentUser.user.id
    if (
      state.thread?.role === "viewer" ||
      (!liveToolCalls.has(result.toolCallId) &&
        !questionnaire &&
        !closure &&
        !toolResults.has(toolResultKey(result.toolCallId)))
    ) {
      reportError(
        new Error("This tool call belongs to another session and cannot be executed here."),
      )
      return
    }
    if (closure && !toolResults.has(toolResultKey(result.toolCallId)))
      toolResults.set(toolResultKey(result.toolCallId), { outcome: "unknown", output: null })
    else if (!toolResults.has(toolResultKey(result.toolCallId)) && "tool" in result) {
      const output: unknown = result.output
      toolResults.set(toolResultKey(result.toolCallId), {
        outcome: result.state === "output-error" ? "failed" : "succeeded",
        output: output ?? null,
      })
    }
    scopeCompletedToolCalls()
    liveTurn = true
    if (
      pending &&
      (!("tool" in result) ||
        result.toolCallId ===
          savedToolCallId(pending.sourceMessageId, pending.sourcePartId, pending.responseTargetId))
    ) {
      replaceClient()
      await hydration
      if (generation !== selectionGeneration) return
      update({ threadLoading: false })
      await client.append({
        role: "tool",
        toolCallId: result.toolCallId,
        content: JSON.stringify(toolResults.get(toolResultKey(result.toolCallId))),
      })
    } else if ("tool" in result) {
      await client.addToolResult(result)
    }
    if (generation === selectionGeneration)
      await refreshThread(client.getError() !== undefined, false)
    void drainQueue()
  }
  const abandonToolCall = (toolCallId: string) => addToolResult({ toolCallId })

  const canSubmitMessage = (retrying: boolean) => {
    const reason = state.threadLoadFailed
      ? "Reopen this conversation or start a new one before sending."
      : !retrying && state.thread?.role === "viewer"
        ? "You have read-only access to this conversation."
        : !retrying && state.thread?.agentId === null
          ? "This conversation’s agent is unavailable. Start a new conversation to continue."
          : undefined
    if (reason) reportError(new Error(reason))
    return reason === undefined
  }

  const dispatchMessage = async (entry: PendingChatMessage) => {
    const { content } = entry
    const callbacks = pendingCallbacks.get(entry.id)
    if (sending || state.threadLoading || state.status === "streaming") {
      reportError(new Error("Wait for this client's current request to finish before sending."))
      return
    }
    const samePendingContent =
      pendingSend !== undefined && JSON.stringify(pendingSend.content) === JSON.stringify(content)
    const uncertainSend =
      pendingSend?.tools !== undefined && !pendingSend.accepted ? pendingSend : undefined
    const retrying = uncertainSend !== undefined && samePendingContent
    if (!canSubmitMessage(retrying)) return
    if (uncertainSend && !samePendingContent) {
      update({ unsentMessage: uncertainSend.content })
      reportError(
        new Error(
          "The previous message’s acceptance is unconfirmed. Retry that message before sending different text, or start a new conversation.",
        ),
      )
      return
    }
    const generation = selectionGeneration
    historyGeneration++
    update({ olderMessagesLoading: false })
    sending = true
    liveTurn = true
    if (
      !pendingSend ||
      pendingSend.accepted ||
      pendingSend.key !== entry.id ||
      !samePendingContent
    ) {
      pendingSend = {
        content,
        accepted: false,
        key: entry.id,
        callbacks: callbacks ?? (samePendingContent ? pendingSend?.callbacks : undefined),
        tools: entry.tools,
      }
      client.stop()
      liveToolCalls.clear()
      scopeCompletedToolCalls()
      liveToolMessageIds.clear()
      update({ activeToolCallIds: [], activeTurnId: undefined, activeTurnState: undefined })
    }
    pendingSend.callbacks ??= callbacks
    entry.status = "sending"
    publishQueue()
    update({ unsentMessage: content, error: undefined, status: "submitted" })
    try {
      await ensureThread()
      if (generation !== selectionGeneration) return
      pendingSend.callbacks?.onThreadReady?.(state.thread!.id)
      if (generation !== selectionGeneration) return
      scopeCompletedToolCalls()
      await client.sendMessage(content)
      if (generation !== selectionGeneration) return
      const failed = client.getError() !== undefined
      if (pendingSend?.accepted) {
        pendingSend = undefined
        update({ unsentMessage: undefined })
      }
      await refreshThread(failed, false)
    } catch (error) {
      if (generation === selectionGeneration) reportError(error)
    } finally {
      if (generation === selectionGeneration) {
        sending = false
        if (pendingMessages.includes(entry) && !entry.tools) {
          entry.status = "queued"
          publishQueue()
        }
        if (!state.activeTurnState) liveTurn = false
        if (state.error || state.activeTurnState === "interrupted") update({ queuePaused: true })
      }
    }
  }

  const turnBusy = () =>
    sending ||
    state.status === "submitted" ||
    state.status === "streaming" ||
    (liveTurn && (state.activeTurnState === "running" || state.activeTurnState === "waiting")) ||
    (liveTurn &&
      hasPendingToolRun(state.messages, new Set(state.agentTools.map((tool) => tool.name))))
  let draining: Promise<void> | undefined
  const queueHolds = new Set<symbol>()
  const drainQueue = (): Promise<void> => {
    if (draining) return draining
    const generation = selectionGeneration
    draining = (async () => {
      while (
        generation === selectionGeneration &&
        !state.queuePaused &&
        queueHolds.size === 0 &&
        !turnBusy() &&
        !state.threadLoading &&
        !state.threadLoadFailed &&
        !state.error
      ) {
        const entry = pendingMessages.find((message) => message.status !== "accepted")
        if (!entry) return
        if (entry.attachmentsRequired) {
          update({ queuePaused: true })
          return
        }
        if (entry.mode === "steer") {
          await dispatchSteering(entry)
          if (entry.status === "accepted") continue
        }
        if (entry.mode === "steer") return
        await dispatchMessage(entry)
        if (pendingMessages.includes(entry)) {
          update({ queuePaused: true })
          return
        }
      }
    })().finally(() => {
      draining = undefined
      if (generation !== selectionGeneration) void drainQueue()
    })
    return draining
  }
  const requestSteering = async (entry: PendingChatMessage) => {
    const generation = selectionGeneration
    const thread = state.thread
    const turnMessageId = entry.turnMessageId ?? state.activeTurnId
    if (!thread || !turnMessageId || entry.attachmentsRequired) return
    const attempted = entry.status === "sending"
    entry.mode = "steer"
    entry.turnMessageId = turnMessageId
    publishQueue()
    try {
      const auth = await requestOptions()
      if (generation !== selectionGeneration) return
      entry.status = "sending"
      publishQueue()
      const parts = typeof entry.content === "string" ? entry.content : entry.content.content
      const receipt = await steerChatTurn(
        thread.id,
        {
          client_id: clientId,
          turn_message_id: turnMessageId,
          parts: (typeof parts === "string"
            ? [{ type: "text", content: parts }]
            : parts) as Parameters<typeof steerChatTurn>[1]["parts"],
        },
        { ...auth, headers: { "Idempotency-Key": entry.id } },
      )
      if (generation !== selectionGeneration) return
      entry.status = "accepted"
      entry.acceptedMessageId = receipt.accepted_message_id
      if (state.messages.some((message) => message.id === receipt.accepted_message_id))
        pendingMessages = pendingMessages.filter((message) => message.id !== entry.id)
      update({
        thread: {
          ...state.thread!,
          version: Math.max(state.thread!.version, receipt.thread_version),
        },
      })
      pendingCallbacks.get(entry.id)?.onAccepted?.()
      pendingCallbacks.delete(entry.id)
      publishQueue()
    } catch (error) {
      if (generation !== selectionGeneration) return
      if (
        isAstralBeamApiError(error) &&
        error.status === 409 &&
        error.body?.detail === "This turn has finished. Queue your message as a new turn"
      ) {
        entry.mode = "queue"
        entry.status = "queued"
        entry.steeringFallback = true
        const callbacks = pendingCallbacks.get(entry.id)
        pendingCallbacks.delete(entry.id)
        entry.id = newUuid()
        if (callbacks) pendingCallbacks.set(entry.id, callbacks)
        entry.turnMessageId = undefined
        publishQueue()
      } else {
        if (
          !attempted &&
          isAstralBeamApiError(error) &&
          [400, 403, 404, 413, 429].includes(error.status)
        )
          entry.status = "queued"
        const failure = error instanceof Error ? error : new Error(String(error))
        update({ queuePaused: true, error: failure })
        publishQueue()
        live.streamCallbacks?.onError?.(failure)
      }
    }
  }
  const steeringRequests = new Map<PendingChatMessage, Promise<void>>()
  const dispatchSteering = (entry: PendingChatMessage): Promise<void> => {
    const pending = steeringRequests.get(entry)
    if (pending) return pending
    const request = requestSteering(entry).finally(() => steeringRequests.delete(entry))
    steeringRequests.set(entry, request)
    return request
  }
  const sendMessage = async (
    content: string | MultimodalContent,
    callbacks?: ChatSubmissionCallbacks,
    options?: { whenBusy: "queue" | "steer" },
  ) => {
    const navigation = navigationGeneration
    try {
      await getValidChatAuthToken(authentication)
    } catch (error) {
      if (navigation === navigationGeneration) {
        update({ unsentMessage: content })
        reportError(error)
      }
      return
    }
    if (navigation !== navigationGeneration) return
    const busy = turnBusy() || queueHolds.size > 0
    const uncertain = pendingMessages.find((entry) => entry.status === "sending")
    const retry = !busy
      ? pendingMessages.find(
          (entry) =>
            (entry.status === "sending" || (state.error && entry.id === pendingSend?.key)) &&
            JSON.stringify(entry.content) === JSON.stringify(content),
        )
      : undefined
    if (!canSubmitMessage(Boolean(retry))) return
    if (uncertain && !busy && !retry) {
      update({ unsentMessage: uncertain.content })
      reportError(
        new Error(
          "The previous message’s acceptance is unconfirmed. Retry that message before sending different text, or start a new conversation.",
        ),
      )
      return
    }
    const entry = retry ?? {
      id: newUuid(),
      content,
      mode: "queue" as const,
      status: "queued" as const,
      attachmentsRequired: false,
    }
    const awaitingResume = state.queuePaused && pendingMessages.length > 0 && !retry
    if (!retry) pendingMessages.push(entry)
    if (callbacks) pendingCallbacks.set(entry.id, callbacks)
    publishQueue()
    if (busy || awaitingResume) {
      try {
        callbacks?.onQueued?.()
      } catch (error) {
        debug?.("error", "Queued callback failed", error)
      }
      if (busy && options?.whenBusy === "steer" && liveTurn && state.activeTurnId)
        await dispatchSteering(entry)
      return
    }
    if (retry) {
      update({ error: undefined })
      if (retry.mode === "steer") await dispatchSteering(retry)
      else await dispatchMessage(retry)
      return
    }
    update({ queuePaused: false, error: undefined })
    await drainQueue()
  }

  const observeAuthentication = () => {
    const auth = authenticationState(authentication)
    if (auth.status === "ready") {
      const nextIdentity = authenticationIdentity(auth.currentUser)
      if (identity !== undefined && identity !== nextIdentity) {
        navigationGeneration++
        pendingSends.clear()
        threadToolResults.clear()
        toolResults.clear()
        pendingSend = undefined
      }
      identity = nextIdentity
      const nextThreadKey = `astralbeam:thread:${live.apiUrl ?? DEFAULT_API_URL}:${nextIdentity}`
      if (threadKey !== nextThreadKey) {
        try {
          clientId = globalThis.sessionStorage?.getItem(`${nextThreadKey}:client`) ?? newUuid()
          globalThis.sessionStorage?.setItem(`${nextThreadKey}:client`, clientId)
        } catch {
          clientId = newUuid()
        }
        changeSelection()
        threadKey = nextThreadKey
        restoreQueue()
        if (startWithNewThread) {
          selectedThread(nextThreadKey, null)
          startWithNewThread = false
        } else {
          selectConfiguredThread(true)
        }
      }
      if (capabilityIdentity !== nextIdentity) {
        capabilityIdentity = nextIdentity
        void resolveCapabilities()
      }
    }
    update({ auth })
  }
  const start = () => {
    if (started) return
    started = true
    client.attach()
    if (requestController.signal.aborted) requestController = new AbortController()
    unsubscribeAuthentication = subscribeAuthentication(authentication, observeAuthentication)
    observeAuthentication()
    stopAuthentication = startAuthentication(authentication)
  }
  if (!deferStart) start()

  return {
    start,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    updateOptions: (next) => {
      const agent = live.agentId
      const apiUrl = live.apiUrl
      const selectedId = live.threadId
      const { widgets, onRenderWidget } = live
      live = { ...live, ...next }
      debug = createDebugLogger(live.debug)
      updateAuthentication(authentication, {
        apiUrl: live.apiUrl,
        fetchAstralBeamToken: live.fetchAstralBeamToken ?? { url: DEFAULT_CHAT_AUTH_TOKEN_URL },
      })
      authentication.debug = debug
      client.updateOptions({ tools: declareTools(), forwardedProps: forwardedProps() })
      if (live.apiUrl !== apiUrl) {
        navigationGeneration++
        pendingSends.clear()
        threadToolResults.clear()
        toolResults.clear()
        pendingSend = undefined
        changeSelection()
        threadKey = undefined
        update({ threadLoading: false })
        observeAuthentication()
      } else if (live.threadId !== selectedId) {
        selectConfiguredThread()
      }
      if (widgets !== live.widgets || onRenderWidget !== live.onRenderWidget)
        restoreCompletedWidgets(state.messages)
      if (started && (live.agentId !== agent || live.apiUrl !== apiUrl)) void resolveCapabilities()
    },
    sendMessage,
    editPendingMessage: (id, content) => {
      const entry = pendingMessages.find((message) => message.id === id)
      if (
        !entry ||
        entry.status === "accepted" ||
        (entry.status === "sending" && !entry.attachmentsRequired)
      )
        return false
      if (
        entry.status === "sending" &&
        pendingMessageText(content) !== pendingMessageText(entry.content)
      )
        return false
      entry.content = content
      entry.attachmentsRequired =
        entry.attachmentsRequired &&
        (typeof content === "string" ||
          !Array.isArray(content.content) ||
          !content.content.some((part) => part.type !== "text"))
      publishQueue()
      return true
    },
    removePendingMessage: (id) => {
      pendingMessages = pendingMessages.filter(
        (entry) => entry.id !== id || entry.status !== "queued",
      )
      pendingCallbacks.delete(id)
      publishQueue()
    },
    steerPendingMessage: async (id) => {
      const entry = pendingMessages.find((message) => message.id === id)
      if (
        entry?.status === "queued" &&
        liveTurn &&
        state.activeTurnId &&
        !entry.attachmentsRequired
      )
        await dispatchSteering(entry)
    },
    resumeQueue: async () => {
      update({ queuePaused: false, error: undefined })
      const uncertain = pendingMessages.find(
        (entry) => entry.mode === "steer" && entry.status === "sending",
      )
      if (uncertain) await dispatchSteering(uncertain)
      await drainQueue()
    },
    holdQueue: () => {
      const hold = Symbol()
      queueHolds.add(hold)
      return () => {
        if (queueHolds.delete(hold) && queueHolds.size === 0 && !state.queuePaused)
          void drainQueue()
      }
    },
    addToolResult,
    stop: () => {
      liveTurn = false
      update({ queuePaused: true })
      client.stop()
    },
    retryAuthentication: () => {
      void getValidChatAuthToken({ ...authentication, force: true }).catch(() => undefined)
    },
    reload: async () => {
      liveTurn = false
      update({ queuePaused: true })
      const generation = selectionGeneration
      await refreshThread()
      if (generation !== selectionGeneration || state.error) return
      const attempted = new Set<string>()
      while (generation === selectionGeneration) {
        const pending = state.pendingInteractions.find(
          (item) =>
            !attempted.has(item.sourceMessageId) && toolResults.has(toolResultKey(item.toolCallId)),
        )
        if (!pending) return
        attempted.add(pending.sourceMessageId)
        await addToolResult({ toolCallId: pending.toolCallId })
        if (state.error) return
      }
    },
    searchThreads: async (q = "", cursor, signal) => {
      const options = await requestOptions()
      const page = await listChatThreads(
        { q, page_size: 50, ...(cursor ? { page_after: cursor } : {}) },
        { ...options, signal: AbortSignal.any([options.signal!, ...(signal ? [signal] : [])]) },
      )
      return {
        items: page.items.map((record) => threadFromRecord(record)),
        page_after: page.page_after,
      }
    },
    openThread,
    renameThread,
    deleteThread,
    refreshThread,
    loadOlderMessages,
    getAttachment: async (messageId, partId) => {
      const thread = state.thread
      if (!thread) throw new Error("Open a conversation before downloading attachments.")
      const response = await getChatAttachment(thread.id, messageId, partId, await requestOptions())
      return response.blob()
    },
    abandonToolCall,
    reset: () => {
      debug?.("status", "conversation reset")
      newThread()
    },
    dispose: () => {
      update({ queuePaused: true })
      publishQueue()
      client.detach()
      disposeRenders()
      client.stop()
      requestController.abort()
      selectionGeneration++
      threadKey = undefined
      capabilitiesGeneration++
      capabilityIdentity = undefined
      stopAuthentication?.()
      unsubscribeAuthentication?.()
      disposeChatAuthentication(authentication)
      started = false
      // React Strict Mode immediately restarts a committed session. Dispose the client only if
      // that restart did not happen: https://react.dev/reference/react/useEffect#caveats
      queueMicrotask(() => {
        if (!started) client.dispose()
      })
      listeners.clear()
    },
  }
}
