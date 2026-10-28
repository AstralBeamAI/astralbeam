import {
  ChatClient,
  type ChatClientSnapshot,
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
  getThreadAttachment,
  type GetThreadAttachmentParams,
  getChatConfig,
  uploadChatFile,
  type UploadedChatFile,
  type ChatHistoryPageEncodedMessagesItem,
  getResolveChatToolResultUrl,
  getRunChatUrl,
  listChatThreads,
  updateChatThread,
  personalMcpGetCatalog,
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
import { buildAgentTools, HOST_TOOL_NOT_EXECUTED, type WidgetDeclaration } from "./agent-tools.ts"
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
import {
  manageMcpConnection,
  authorizeMcpConnection,
  type McpCatalog,
  type McpConnectionOperation,
} from "./mcp.ts"
import { isSettledToolCall } from "./messages.ts"
import { webPartMetadata } from "./web.ts"
import {
  ASK_QUESTIONNAIRE_TOOL,
  RENDER_WIDGET_TOOL,
  SANDBOX_STATUS_EVENT,
  USAGE_LIMIT_REACHED_EVENT,
} from "./protocol.ts"
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

import {
  loadPendingMessages,
  storePendingMessages,
  pendingMessageText,
  type PendingChatMessage,
} from "./pending-messages.ts"

const HISTORY_FAILED = "Reopen this conversation or start a new one before sending."

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
  /** The session retained this input locally. Server acceptance is separate. */
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

/**
 * One send and its outcome in the selected conversation. `failed` means the server may have
 * accepted it, so only `retry()` can resend it. `refused` means it was not accepted.
 */
export interface ChatSubmission {
  id: string
  content: string | MultimodalContent
  phase: "submitting" | "accepted" | "failed" | "refused" | "queued"
  error?: Error | undefined
}

export interface AstralBeamChatState {
  messages: ChatClientSnapshot["messages"]
  /** The run status: "ready", "submitted", "streaming", or "error". */
  status: ChatClientState
  /** The latest failure outside a submission, such as history loading or a failed reply. */
  error: Error | undefined
  auth: ChatAuthenticationState
  /** What the resolved agent grants; the UI should render only that. */
  capabilities: { attachments: boolean }
  /** The tool set currently declared to the agent, in declaration order. */
  serverToolTitles?: Readonly<Record<string, string>>
  unavailableMcpConnections?: readonly string[]
  agentTools: readonly AgentToolInfo[]
  sandboxStatus: SandboxStatus | undefined
  /** The usage limit that ended the last run, by display name, until another run starts. */
  usageLimitReached: { name: string; resetsAt: string } | undefined
  sandbox: SandboxActivity
  thread: ChatThread | undefined
  /** Saved history: `loading` has nothing to show yet, `refreshing` reloads behind the transcript. */
  history: "idle" | "loading" | "refreshing" | "failed"
  messagesCursor: string | undefined
  olderMessagesLoading: boolean
  submission: ChatSubmission | undefined
  pendingMessages: readonly PendingChatMessage[]
  queuePaused: boolean
  activeTurnId: string | undefined
  activeTurnState: "running" | "waiting" | "completed" | "interrupted" | undefined
  activeToolCallIds: readonly string[]
  pendingInteractions: readonly ChatPendingInteraction[]
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
  /**
   * Sends a message as the new `submission`, persisting it before generation begins. Resolves with
   * the attempt's outcome. A `refused` one, including an attempt the session declined, returns its
   * content to the caller.
   */
  sendMessage: (
    content: string | MultimodalContent,
    callbacks?: ChatSubmissionCallbacks,
    options?: { whenBusy: "queue" | "steer" },
  ) => Promise<ChatSubmission>
  /** Resends a `failed` submission with its original key and callbacks, resolving its outcome. */
  retry: () => Promise<ChatSubmission | undefined>
  editPendingMessage: (id: string, content: string | MultimodalContent) => boolean
  removePendingMessage: (id: string) => void
  steerPendingMessage: (id: string) => Promise<void>
  resumeQueue: () => Promise<void>
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
  uploadAttachment: (file: {
    data: string | Promise<string>
    filename: string
    mimeType: string
  }) => Promise<UploadedChatFile>
  getThreadAttachment: (
    params: GetThreadAttachmentParams,
    options?: { preview?: boolean },
  ) => Promise<Blob>
  getMcpCatalog: () => Promise<McpCatalog>
  manageMcpConnection: (operation: McpConnectionOperation) => ReturnType<typeof manageMcpConnection>
  authorizeMcpConnection: (input: Parameters<typeof authorizeMcpConnection>[0]) => Promise<void>
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
    usageLimitReached: undefined,
    sandbox: { files: [], commands: [] },
    thread: undefined,
    history: "idle",
    messagesCursor: undefined,
    olderMessagesLoading: false,
    submission: undefined,
    pendingMessages: [],
    queuePaused: false,
    activeTurnId: undefined,
    activeTurnState: undefined,
    activeToolCallIds: [],
    pendingInteractions: [],
  }
  // The selected conversation's admitted send. Retryable sends are kept per conversation.
  type Submission = ChatSubmission & {
    key: string
    tools?: Array<Record<string, unknown>> | undefined
    callbacks?: ChatSubmissionCallbacks | undefined
    /** Hands a refused send back to its sender at once, before its pending work unwinds. */
    onRefused?: () => void
    /** The current delivery attempt. Identity and key stay stable across Retry, authority does not. */
    attempt: number
    queued?: boolean
  }
  let submission: Submission | undefined
  const submissions = new Map<string, Submission>()
  let pendingMessages: PendingChatMessage[] = []
  const pendingQueues = new Map<string, PendingChatMessage[]>()
  let queueKey: string | undefined
  const pendingCallbacks = new Map<string, ChatSubmissionCallbacks | undefined>()
  const steeringRequests = new Map<PendingChatMessage, Promise<void>>()
  const queueHolds = new Set<symbol>()
  let draining = false
  let delivering: Submission | undefined
  // The session owns the run status, so a send is "submitted" while its conversation is prepared,
  // and a replaced client's reports never reach it.
  let clientStatus: ChatClientState = "ready"
  const update = (next: Partial<AstralBeamChatState>) => {
    const status =
      submission?.phase === "submitting" && clientStatus !== "streaming"
        ? "submitted"
        : clientStatus
    state = {
      ...state,
      ...next,
      status,
      ...(next.error || next.auth?.status === "error" ? { queuePaused: true } : {}),
    }
    for (const listener of listeners) listener()
    queueMicrotask(() => void drainQueue())
  }
  const project = ({ id, content, phase, error }: Submission): ChatSubmission => ({
    id,
    content,
    phase,
    ...(error ? { error } : {}),
  })
  // Only these moves are legal, so a late report cannot reopen a settled send.
  const nextPhases: Record<ChatSubmission["phase"], readonly ChatSubmission["phase"][]> = {
    queued: [],
    submitting: ["accepted", "failed", "refused"],
    failed: ["submitting"],
    accepted: [],
    refused: [],
  }
  const settle = (sent: Submission, phase: ChatSubmission["phase"], error?: Error) => {
    if (!nextPhases[sent.phase].includes(phase)) return false
    sent.phase = phase
    sent.error = error
    if (phase === "refused") {
      if (sent === submission) delivering = undefined
      const entry = pendingMessages.find((entry) => entry.id === sent.id)
      if (entry && sent.queued) {
        entry.status = "queued"
        delete entry.tools
      } else pendingMessages = pendingMessages.filter((entry) => entry.id !== sent.id)
      publishQueue()
    }
    if (sent === submission) update({ submission: project(sent) })
    if (phase === "refused") sent.onRefused?.()
    return true
  }
  // A delivery attempt acts only while it is the session's submission and its current attempt, and
  // it continues dispatching only while that send is still submitting.
  const current = (sent: Submission, attempt: number) =>
    sent === submission && sent.attempt === attempt
  const owns = (sent: Submission, attempt: number) =>
    current(sent, attempt) && sent.phase === "submitting"
  // A dispatched send may have reached the server, so it keeps Retry. Otherwise it was not sent.
  const endUnaccepted = (sent: Submission, error?: Error) =>
    settle(
      sent,
      sent.tools ? "failed" : "refused",
      error ??
        (sent.tools
          ? new Error("This message may not have been sent. Retry to send it.")
          : undefined),
    )
  // Every owner change settles the send before dropping it, so no orphan keeps submitting.
  const releaseSubmission = (reason: string) => {
    const released = submission
    if (released?.phase === "submitting")
      endUnaccepted(released, released.tools ? undefined : new Error(reason))
    submission = undefined
    delivering = undefined
    return released
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
  let toolExecutionGeneration = 0
  let historyGeneration = 0
  let hydration: Promise<unknown> = Promise.resolve()
  let requestController = new AbortController()
  let threadKey: string | undefined
  let startWithNewThread = false
  let threadRecords: Awaited<ReturnType<typeof loadThreadMessages>>["messages"] = []
  type MessagePresentation = {
    attachmentParts?: UIMessage["parts"]
    renderIds?: ReadonlyMap<string, string>
  }
  const messagePresentation = new Map<string, MessagePresentation>()
  let presentationVersion = 0
  let projectedMessages = new WeakMap<
    UIMessage,
    { presentation: MessagePresentation | undefined; message: UIMessage }
  >()
  const rememberAttachments = (messages: readonly UIMessage[]) => {
    for (const message of messages) {
      // Accepted user content is immutable. Keep its saved download parts across model snapshots.
      if (
        message.role !== "user" ||
        messagePresentation.get(message.id)?.attachmentParts ||
        !message.parts.some((part) => "fileId" in part)
      )
        continue
      const parts = message.parts.map((part) => Object.freeze({ ...part }))
      Object.freeze(parts)
      messagePresentation.set(message.id, {
        ...messagePresentation.get(message.id),
        attachmentParts: parts,
      })
      presentationVersion++
    }
  }
  let clientId = newUuid()
  const acceptSubmission = () => {
    if (!submission || !settle(submission, "accepted")) return
    if (state.thread) update({ thread: { ...state.thread, hasMessages: true } })
    pendingCallbacks.delete(submission.id)
    pendingMessages = pendingMessages.filter((entry) => entry.id !== submission!.id)
    publishQueue()
    notifySubmission(submission.callbacks?.onAccepted)
  }
  const replaceAcceptedMessage = (record: ChatHistoryPageEncodedMessagesItem) => {
    const messages = [...client.getSnapshot().messages]
    const index = messages.findLastIndex((message) => message.role === "user")
    if (index !== -1) {
      messages[index] = projectThreadMessages([record])[0]!
      rememberAttachments([messages[index]])
      client.setMessagesManually(messages)
      if (unsubscribeSnapshot) observeSnapshot()
    }
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

  const notifyError = (error: Error) => {
    if (state.auth.status !== "error" || state.auth.error !== error)
      live.streamCallbacks?.onError?.(error)
  }
  const reportError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return
    const failure = error instanceof Error ? error : new Error(String(error))
    update({ error: failure })
    notifyError(failure)
  }
  const clearUnavailableMcpConnection = (id: string) => {
    update({
      unavailableMcpConnections:
        state.unavailableMcpConnections?.filter((entry) => entry !== id) ?? [],
    })
  }
  const requestOptions = async (conversation = true): Promise<JwtOptions> => {
    const generation = selectionGeneration
    const authSignal = authentication.session.abortController.signal
    const token = await getValidChatAuthToken(authentication)
    authSignal.throwIfAborted()
    if (conversation && generation !== selectionGeneration)
      throw new DOMException("Conversation changed", "AbortError")
    return {
      apiUrl: authentication.apiUrl,
      astralBeamToken: token,
      cache: "no-store",
      signal: conversation ? AbortSignal.any([requestController.signal, authSignal]) : authSignal,
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

  const projectMessages = (messages: ChatClientSnapshot["messages"]) =>
    Object.freeze(
      messages.map((message) => {
        let presentation = messagePresentation.get(message.id)
        const cached = projectedMessages.get(message)
        if (cached && cached.presentation === presentation) return cached.message
        let parts = presentation?.attachmentParts ?? message.parts
        let renderIds = presentation?.renderIds
        const nextParts = parts.map((part) => {
          if (
            part.type !== "tool-call" ||
            part.name !== RENDER_WIDGET_TOOL ||
            part.state !== "complete" ||
            !part.input
          )
            return part
          const stored: ChatToolCallPart = part
          const alias = savedToolCallId(message.id, part.id)
          const canonical = stored.applicationPartId
            ? savedToolCallId(message.id, stored.applicationPartId, stored.responseTargetId)
            : alias
          const upstream = stored.upstreamToolCallId
          const renderId =
            stored.widgetRenderId ??
            renderIds?.get(alias) ??
            renderIds?.get(canonical) ??
            (upstream &&
            liveToolMessageIds.get(upstream) === message.id &&
            restoredWidgets.has(upstream)
              ? upstream
              : part.id)
          if (renderIds?.get(alias) !== renderId || renderIds.get(canonical) !== renderId) {
            renderIds = new Map(renderIds).set(alias, renderId).set(canonical, renderId)
          }
          return stored.widgetRenderId === renderId
            ? part
            : Object.freeze({ ...part, widgetRenderId: renderId })
        })
        if (nextParts.some((part, index) => part !== parts[index])) {
          Object.freeze(nextParts)
          parts = nextParts
        }
        if (renderIds && renderIds !== presentation?.renderIds) {
          presentation = { ...presentation, renderIds }
          messagePresentation.set(message.id, presentation)
          presentationVersion++
        }
        const projected = parts === message.parts ? message : Object.freeze({ ...message, parts })
        projectedMessages.set(message, { presentation, message: projected })
        return projected
      }),
    )

  const restoreCompletedWidgets = (messages: readonly UIMessage[]) => {
    if (state.thread?.role === "viewer") return
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type !== "tool-call" ||
          part.name !== RENDER_WIDGET_TOOL ||
          part.state !== "complete" ||
          !part.input
        )
          continue
        const stored: ChatToolCallPart = part
        const renderId = stored.widgetRenderId ?? part.id
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

  const buildTools = () => {
    const selection = selectionGeneration
    return buildAgentTools(
      live.widgets ?? {},
      live.tools ?? {},
      renderWidget,
      debug,
      (name, declaration, toolCallId) => {
        const execution = toolExecutionGeneration
        const executingClient = client
        const executingIdentity = identity
        const apiUrl = authentication.apiUrl
        return () => {
          const current =
            live.tools && Object.hasOwn(live.tools, name) ? live.tools[name] : undefined
          if (
            selection !== selectionGeneration ||
            execution !== toolExecutionGeneration ||
            executingClient !== client ||
            executingIdentity !== identity ||
            apiUrl !== authentication.apiUrl ||
            state.thread?.role === "viewer" ||
            !toolCallId ||
            !liveToolCalls.has(toolCallId) ||
            !current ||
            current.parameters !== declaration.parameters
          )
            throw new DOMException("Host tool authority changed", "AbortError")
          return current
        }
      },
    ).map((tool) => {
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
            if (
              !(error instanceof Error && HOST_TOOL_NOT_EXECUTED in error) &&
              identity === resultIdentity &&
              authentication.apiUrl === apiUrl
            )
              results.set(key, {
                outcome: "unknown",
                output: { error: error instanceof Error ? error.message : String(error) },
              })
            throw error
          }
        },
      }
    })
  }
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
    const sent =
      body.messages.at(-1)?.role === "user" && submission?.phase === "submitting"
        ? submission
        : undefined
    const previouslyAttempted = sent?.tools !== undefined
    if (sent) {
      payload = {
        ...body,
        threadId: thread.id,
        resume: undefined,
        parentRunId: undefined,
        messages: [body.messages.at(-1)],
        tools: (sent.tools ??= body.tools),
        forwardedProps: {
          ...body.forwardedProps,
          clientId,
        },
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
    if (sent) {
      headers.set("Idempotency-Key", sent.key)
      let entry = pendingMessages.find((entry) => entry.id === sent.id)
      if (!entry) {
        entry = {
          id: sent.id,
          key: sent.key,
          content: sent.content,
          mode: "queue",
          status: "sending",
          attachmentsRequired: false,
        }
        pendingMessages.push(entry)
      }
      entry.status = "sending"
      entry.tools = sent.tools
      publishQueue()
    }
    const response = await astralBeamChatFetch(path, {
      ...auth,
      ...init,
      headers,
      body: JSON.stringify(payload),
    }).catch((error: unknown) => {
      // The chat client rewraps failures, so the problem's limit is kept before it is lost.
      const limit = isAstralBeamApiError(error) ? error.body?.usage_limit : undefined
      if (limit) update({ usageLimitReached: { name: limit.name, resetsAt: limit.resets_at } })
      if (
        sent &&
        !previouslyAttempted &&
        isAstralBeamApiError(error) &&
        [400, 403, 404, 413, 429].includes(error.status)
      )
        delete sent.tools
      throw error
    })
    if (generation !== selectionGeneration)
      throw new DOMException("Conversation changed", "AbortError")
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const receipt = (await response.json()) as {
        thread_version: number
        accepted_message_id: string
        usage_limit?: { name: string; resets_at: string }
      }
      if (generation !== selectionGeneration)
        throw new DOMException("Conversation changed", "AbortError")
      update({
        thread: { ...state.thread!, version: receipt.thread_version },
        // Saved tool results whose continuation a used-up limit skipped.
        ...(receipt.usage_limit
          ? {
              usageLimitReached: {
                name: receipt.usage_limit.name,
                resetsAt: receipt.usage_limit.resets_at,
              },
            }
          : {}),
      })
      if (sent) {
        const history = await loadThreadMessages(thread.id, auth, undefined, liveToolMessageIds)
        if (generation !== selectionGeneration)
          throw new DOMException("Conversation changed", "AbortError")
        const accepted = history.messages.find(
          (message) => message.id === receipt.accepted_message_id,
        )
        if (accepted) replaceAcceptedMessage(accepted)
        acceptSubmission()
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
  // TanStack fixes a client's thread ID, so each selected conversation gets its own client. A new
  // chat keeps its client after its first send creates the saved thread, which requests then name.
  const createClient = (): ChatClient => {
    const adapter: ConnectionAdapter = {
      ...connection,
      hydrate: (_id, options) => {
        const threadId = selectedId
        // A new chat has no saved history to request until its first send creates the thread.
        if (!threadId)
          return Promise.resolve({
            messages: [],
            activeRun: null,
            interrupts: null,
            page: { truncated: false },
          })
        // The latest full read owns thread-wide state. An older page only adds its messages, and a
        // newer full read supersedes it. A client's work stays valid until that client is replaced.
        const older = options?.before !== undefined
        const readGeneration = older ? historyGeneration : ++historyGeneration
        // Like TanStack Query's isLoading and isRefetching, loading means nothing is shown yet.
        if (!options?.before)
          update({
            olderMessagesLoading: false,
            history:
              state.messages.length > 0 || state.thread?.hasMessages === false
                ? "refreshing"
                : "loading",
          })
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
          if (client !== next || readGeneration !== historyGeneration)
            throw new DOMException("Conversation changed", "AbortError")
          if (!older) retainToolResults(history)
          threadRecords = older ? [...history.messages, ...threadRecords] : history.messages
          const pageIds = new Set(history.messages.map((message) => message.id))
          const messages = projectThreadMessages(
            threadRecords,
            older ? state.pendingInteractions : history.pendingInteractions,
            liveToolMessageIds,
          ).filter((message) => pageIds.has(message.id))
          rememberAttachments(messages)
          if (older) update({ messagesCursor: history.page_after ?? undefined })
          else {
            if (history.thread.role === "viewer") disposeRenders()
            const agentChanged = state.thread?.agentId !== history.thread.agent_id
            update({
              thread: threadFromRecord(history.thread, history.messages.length > 0),
              messagesCursor: history.page_after ?? undefined,
              pendingInteractions: history.pendingInteractions,
            })
            if (agentChanged) void resolveCapabilities()
            // TanStack leaves local messages unchanged for an empty hydration page.
            // An empty saved thread must remove rejected optimistic input.
            if (messages.length === 0) next.setMessagesManually([])
          }
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
        if (!older) {
          // Settle the phase after ChatClient applies the page, including hydration on React remount.
          const settled = read
            .then(
              () => "idle" as const,
              () => "failed" as const,
            )
            .then(
              (history) =>
                new Promise<void>((resolve) =>
                  queueMicrotask(() => {
                    if (client === next && readGeneration === historyGeneration) {
                      if (unsubscribeSnapshot) observeSnapshot()
                      update({ history })
                    }
                    resolve()
                  }),
                ),
            )
          hydration = settled.then(() => read)
          void hydration.catch(() => undefined)
        }
        return read
      },
    }
    const next: ChatClient = new ChatClient({
      connection: adapter,
      threadId: selectedId ?? clientId,
      persistence: true,
      history: { pageSize: 100 },
      queue: "drop",
      tools: declareTools(),
      forwardedProps: forwardedProps(),
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
            acceptedMessage?: ChatHistoryPageEncodedMessagesItem
            executableToolCallIds?: string[]
            turnMessageId?: string
            turnState?: AstralBeamChatState["activeTurnState"]
            appliedSteeringMessageIds?: string[]
          }
          if (state.thread?.id === event.threadId) {
            if (event.acceptedMessage && submission?.phase === "submitting")
              replaceAcceptedMessage(event.acceptedMessage)
            if (event.acceptedMessageId) acceptSubmission()
            if (event.appliedSteeringMessageIds?.length) {
              pendingMessages = pendingMessages.filter(
                (entry) =>
                  !event.appliedSteeringMessageIds!.includes(entry.acceptedMessageId ?? ""),
              )
              publishQueue()
            }
            if (event.saved)
              for (const id of event.executableToolCallIds ?? []) {
                if (!liveToolCalls.has(id)) toolResults.delete(toolResultKey(id))
                liveToolCalls.add(id)
              }
            update({
              thread: { ...state.thread, version: event.version ?? state.thread.version },
              ...(event.turnState
                ? {
                    activeTurnId:
                      event.turnState === "running" || event.turnState === "waiting"
                        ? event.turnMessageId
                        : undefined,
                    activeTurnState: event.turnState,
                    ...(event.turnState === "interrupted" ? { queuePaused: true } : {}),
                  }
                : {}),
              activeToolCallIds: [...liveToolCalls],
            })
          }
          return
        }
        if (eventType === "astralbeam_mcp_tools") {
          const event = data as {
            tools?: { name: string; title: string }[]
            unavailable?: string[]
          }
          const titles: Record<string, string> = {}
          for (const tool of event.tools ?? [])
            if (typeof tool.name === "string" && typeof tool.title === "string")
              titles[tool.name] = tool.title
          update({ serverToolTitles: titles, unavailableMcpConnections: event.unavailable ?? [] })
          return
        }
        const limit = data as { name?: unknown; resetsAt?: unknown } | undefined
        if (
          eventType === USAGE_LIMIT_REACHED_EVENT &&
          typeof limit?.name === "string" &&
          typeof limit.resetsAt === "string"
        ) {
          update({ usageLimitReached: { name: limit.name, resetsAt: limit.resetsAt } })
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
        if (chunk.type === EventType.RUN_STARTED)
          update({ serverToolTitles: {}, unavailableMcpConnections: [] })
        if (chunk.type === EventType.RUN_FINISHED && chunk.outcome?.type !== "interrupt")
          update({ activeTurnId: undefined })
        live.streamCallbacks?.onChunk?.(chunk)
      },
      onResponse: (response) => {
        if (client === next) live.streamCallbacks?.onResponse?.(response)
      },
      onFinish: (message) => {
        if (client === next) live.streamCallbacks?.onFinish?.(message)
      },
      onError: (error) => {
        if (client !== next) return
        // An unaccepted send keeps its failure on the submission.
        if (submission?.phase !== "submitting" && error.name !== "AbortError") update({ error })
        notifyError(error)
      },
    })
    return next
  }
  let selectedId: string | undefined
  let client = createClient()
  let unsubscribeSnapshot: (() => void) | undefined
  let snapshotMessages: ChatClientSnapshot["messages"] | undefined
  let projectedPresentationVersion = -1
  const observeSnapshot = () => {
    const snapshot = client.getSnapshot()
    const messagesChanged =
      snapshotMessages !== snapshot.messages || projectedPresentationVersion !== presentationVersion
    if (!messagesChanged && clientStatus === snapshot.status) return
    const next: Partial<AstralBeamChatState> = {}
    if (clientStatus !== snapshot.status && snapshot.status === "submitted")
      next.usageLimitReached = undefined
    clientStatus = snapshot.status
    if (messagesChanged) {
      rememberAttachments(snapshot.messages)
      next.messages = projectMessages(snapshot.messages)
      next.sandbox = collectSandboxActivity(next.messages)
      snapshotMessages = snapshot.messages
      projectedPresentationVersion = presentationVersion
    }
    update(next)
    if (messagesChanged) {
      restoreCompletedWidgets(state.messages)
      publishQueue()
    }
  }
  const attachClient = () => {
    if (!unsubscribeSnapshot) {
      const observed = client
      const generation = selectionGeneration
      unsubscribeSnapshot = observed.subscribeSnapshot(() => {
        if (client === observed && generation === selectionGeneration) observeSnapshot()
      })
      observeSnapshot()
      restoreCompletedWidgets(state.messages)
    }
    client.attach()
  }
  const replaceClient = (messages?: ChatClientSnapshot["messages"]) => {
    const previous = client
    unsubscribeSnapshot?.()
    unsubscribeSnapshot = undefined
    snapshotMessages = undefined
    // Swap first, so the old client's reports on stop and detach are dropped.
    client = createClient()
    if (messages) client.setMessagesManually(messages)
    clientStatus = "ready"
    previous.stop()
    previous.detach()
    liveToolCalls.clear()
    update({ activeToolCallIds: [] })
    if (started) attachClient()
    previous.dispose()
  }

  // Hydrated tool IDs identify one stored target. Native stream IDs remain unchanged
  // while their originating client's interrupt bindings are active.
  const scopeCompletedToolCalls = () => {
    historicalToolIds.clear()
    client.setMessagesManually(
      client.getSnapshot().messages.map((message) => {
        const aliases = new Map<string, string>()
        const parts = message.parts.map((part) => {
          if (part.type !== "tool-call" || webPartMetadata(part).providerExecuted) return part
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
              ? {
                  widgetRenderId:
                    stored.widgetRenderId ??
                    messagePresentation
                      .get(message.id)
                      ?.renderIds?.get(savedToolCallId(message.id, part.id)) ??
                    part.id,
                }
              : {}),
          }
        })
        if (aliases.size) historicalToolIds.set(message.id, aliases)
        return { ...message, parts }
      }),
    )
  }

  const changeSelection = (threadId?: string) => {
    const previousId = state.thread?.id
    const released = releaseSubmission("The conversation changed before this was sent.")
    if (previousId) {
      if (released?.phase === "failed") submissions.set(previousId, released)
      else submissions.delete(previousId)
      threadToolResults.set(previousId, toolResults)
    }
    selectionGeneration++
    selectedId = threadId
    restoreQueue()
    requestController.abort()
    requestController = new AbortController()
    toolResults = threadToolResults.get(threadId ?? "") ?? new Map<string, ToolResult>()
    historicalToolIds.clear()
    liveToolMessageIds.clear()
    threadRecords = []
    messagePresentation.clear()
    projectedMessages = new WeakMap()
    presentationVersion++
    disposeRenders()
    update({
      thread: undefined,
      messages: [],
      activeTurnId: undefined,
      activeTurnState: undefined,
      queuePaused: true,
      submission: undefined,
      error: undefined,
      sandbox: { files: [], commands: [] },
      sandboxStatus: undefined,
      usageLimitReached: undefined,
      pendingInteractions: [],
      serverToolTitles: {},
      unavailableMcpConnections: [],
      history: "idle",
      messagesCursor: undefined,
      olderMessagesLoading: false,
    })
    replaceClient()
  }

  const openThread = async (id: string, restoring = false) => {
    changeSelection(id)
    const generation = selectionGeneration
    submission = submissions.get(id)
    if (submission) update({ submission: project(submission) })
    try {
      if (!started) attachClient()
      await hydration
      if (generation !== selectionGeneration) return
      if (threadKey) selectedThread(threadKey, id)
    } catch (error) {
      if (generation !== selectionGeneration) return
      if (
        restoring &&
        (live.threadId === undefined || live.threadId === "auto") &&
        isAstralBeamApiError(error) &&
        error.status === 404
      )
        newThread()
      else reportError(error)
    }
  }

  const newThread = () => {
    changeSelection()
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

  // A cancelled send's thread is never published, so it cannot capture a later send.
  const ensureThread = async (sent: Submission, attempt: number) => {
    if (state.thread) return
    const options = await requestOptions()
    const record = await createChatThread(live.agentId ? { agent_id: live.agentId } : {}, options)
    if (!owns(sent, attempt)) throw new DOMException("Send cancelled", "AbortError")
    selectedId = record.id
    const oldQueueKey = queueKey
    queueKey = threadKey ? `${threadKey}:queue:${record.id}` : undefined
    pendingMessages = [...loadPendingMessages(queueKey), ...pendingMessages]
    storePendingMessages(oldQueueKey, [])
    if (oldQueueKey) pendingQueues.delete(oldQueueKey)
    publishQueue()
    update({ thread: threadFromRecord(record, false) })
    void resolveCapabilities()
    if (threadKey) selectedThread(threadKey, record.id)
  }

  // Reloads saved history behind the transcript. Only an explicit refresh clears a shown failure.
  const refreshThread = async (explicit = true) => {
    if (!state.thread) return
    const generation = selectionGeneration
    try {
      client.detach()
      attachClient()
      await hydration
      if (explicit && generation === selectionGeneration) update({ error: undefined })
    } catch (error) {
      if (generation !== selectionGeneration) return
      if (isAstralBeamApiError(error) && error.status === 404) newThread()
      else reportError(error)
    }
  }

  const loadOlderMessages = async () => {
    if (
      !client.getHasOlderMessages() ||
      state.olderMessagesLoading ||
      state.history !== "idle" ||
      submission?.phase === "submitting"
    )
      return
    const generation = selectionGeneration
    update({ olderMessagesLoading: true })
    try {
      await client.loadOlderMessages()
      if (generation === selectionGeneration && unsubscribeSnapshot) observeSnapshot()
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
      update({ thread: renamed })
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
    if (submission?.phase === "submitting" || client.getIsLoading()) {
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
    if (pending) {
      client.stop()
      await refreshThread(false)
      if (generation !== selectionGeneration) return
      await client.append({
        role: "tool",
        toolCallId: result.toolCallId,
        content: JSON.stringify(toolResults.get(toolResultKey(result.toolCallId))),
      })
    } else if ("tool" in result) {
      await client.addToolResult(result)
    }
    if (generation === selectionGeneration) await refreshThread(false)
  }
  const abandonToolCall = (toolCallId: string) => addToolResult({ toolCallId })

  // Dispatches an admitted send. It resumes after each wait only while it still owns its scope, and
  // a send taken during a full history read waits for that read.
  const deliver = async (sent: Submission): Promise<ChatSubmission> => {
    const attempt = ++sent.attempt
    delivering = sent
    try {
      await getValidChatAuthToken(authentication)
      await hydration.catch(() => undefined)
      if (!owns(sent, attempt)) return project(sent)
      if (state.history === "failed") throw new Error(HISTORY_FAILED)
      await ensureThread(sent, attempt)
      if (!owns(sent, attempt)) return project(sent)
      notifySubmission(() => sent.callbacks?.onThreadReady?.(state.thread!.id))
      if (!owns(sent, attempt)) return project(sent)
      scopeCompletedToolCalls()
      await client.sendMessage(sent.content)
      if (!current(sent, attempt)) return project(sent)
      endUnaccepted(sent, client.getError())
      await refreshThread(false)
    } catch (error) {
      if (!current(sent, attempt)) return project(sent)
      const failure = error instanceof Error ? error : new Error(String(error))
      if (failure.name === "AbortError") endUnaccepted(sent)
      else if (endUnaccepted(sent, failure)) notifyError(failure)
    } finally {
      if (current(sent, attempt)) {
        delivering = undefined
        if (sent.phase !== "accepted" || state.error) update({ queuePaused: true })
        publishQueue()
      }
    }
    return project(sent)
  }

  const submitMessage = async (
    content: string | MultimodalContent,
    callbacks?: ChatSubmissionCallbacks,
    entry?: PendingChatMessage,
  ): Promise<ChatSubmission> => {
    const rejection =
      submission?.phase === "submitting" || state.status === "streaming" || client.getIsLoading()
        ? "Wait for this client's current request to finish before sending."
        : state.history === "loading"
          ? "Wait for this conversation to load before sending."
          : state.history === "failed"
            ? HISTORY_FAILED
            : state.thread?.agentId === null
              ? "This conversation’s agent is unavailable. Start a new conversation to continue."
              : state.thread?.role === "viewer"
                ? "You have read-only access to this conversation."
                : submission?.phase === "failed" && submission.id !== entry?.id
                  ? "The previous message’s acceptance is unconfirmed. Retry that message before sending different text, or start a new conversation."
                  : undefined
    // A rejected attempt stays its caller's and never replaces the session's submission.
    if (rejection) return { id: newUuid(), content, phase: "refused", error: new Error(rejection) }
    const sent: Submission = {
      id: entry?.id ?? newUuid(),
      content,
      phase: "submitting",
      key: entry?.key ?? entry?.id ?? newUuid(),
      ...(entry ? { tools: entry.tools, queued: true } : {}),
      callbacks,
      attempt: 0,
    }
    submission = sent
    update({
      submission: project(sent),
      activeTurnId: undefined,
      activeTurnState: undefined,
      error: undefined,
      olderMessagesLoading: false,
      ...(entry ? {} : { queuePaused: false }),
    })
    client.stop()
    liveToolCalls.clear()
    scopeCompletedToolCalls()
    liveToolMessageIds.clear()
    update({ activeToolCallIds: [] })
    const refused = new Promise<void>((resolve) => (sent.onRefused = resolve))
    return Promise.race([deliver(sent), refused.then(() => project(sent))])
  }

  const retry = async () => {
    if (submission?.phase === "failed" && settle(submission, "submitting")) {
      update({ error: undefined })
      return deliver(submission)
    }
    const entry = pendingMessages.find(
      (entry) => entry.status === "sending" || entry.id === submission?.id,
    )
    if (entry) {
      if (entry.attachmentsRequired) return undefined
      if (entry.mode === "steer") {
        await dispatchSteering(entry)
        return undefined
      }
      return submitMessage(entry.content, pendingCallbacks.get(entry.id), entry)
    }
    return undefined
  }

  function notifySubmission(callback?: () => void) {
    try {
      callback?.()
    } catch (error) {
      debug?.("error", "Submission callback failed", error)
    }
  }
  function publishQueue() {
    pendingMessages = pendingMessages.filter(
      (entry) =>
        entry.status !== "accepted" ||
        !state.messages.some((message) => message.id === entry.acceptedMessageId),
    )
    storePendingMessages(queueKey, pendingMessages)
    if (queueKey) pendingQueues.set(queueKey, pendingMessages)
    update({ pendingMessages: pendingMessages.map((entry) => ({ ...entry })) })
  }
  function restoreQueue() {
    storePendingMessages(queueKey, pendingMessages)
    if (queueKey) pendingQueues.set(queueKey, pendingMessages)
    const key = threadKey ? `${threadKey}:queue:${selectedId ?? "new"}` : undefined
    if (key === queueKey) return
    pendingMessages = [
      ...(key ? (pendingQueues.get(key) ?? loadPendingMessages(key)) : []),
      ...(queueKey === undefined ? pendingMessages : []),
    ]
    queueKey = key
    update({ queuePaused: pendingMessages.length > 0 || state.queuePaused })
    publishQueue()
  }
  const turnBusy = () =>
    delivering !== undefined ||
    client.getIsLoading() ||
    state.status === "submitted" ||
    state.status === "streaming" ||
    state.activeTurnId !== undefined

  async function dispatchSteering(entry: PendingChatMessage): Promise<void> {
    if (steeringRequests.has(entry)) return steeringRequests.get(entry)
    const generation = selectionGeneration
    const threadId = state.thread?.id
    const turnMessageId = entry.turnMessageId ?? state.activeTurnId
    if (!threadId || !turnMessageId || entry.attachmentsRequired) return
    const request = (async () => {
      const attempted = entry.status === "sending"
      entry.mode = "steer"
      entry.turnMessageId = turnMessageId
      try {
        const auth = await requestOptions()
        if (generation !== selectionGeneration) return
        entry.status = "sending"
        publishQueue()
        const content = typeof entry.content === "string" ? entry.content : entry.content.content
        const receipt = await steerChatTurn(
          threadId,
          {
            client_id: clientId,
            turn_message_id: turnMessageId,
            parts: (typeof content === "string"
              ? [{ type: "text", content }]
              : content) as Parameters<typeof steerChatTurn>[1]["parts"],
          },
          { ...auth, headers: { "Idempotency-Key": entry.key ?? entry.id } },
        )
        if (generation !== selectionGeneration) return
        entry.status = "accepted"
        entry.acceptedMessageId = receipt.accepted_message_id
        update({
          thread: {
            ...state.thread!,
            version: Math.max(state.thread!.version, receipt.thread_version),
          },
        })
        notifySubmission(pendingCallbacks.get(entry.id)?.onAccepted)
        pendingCallbacks.delete(entry.id)
      } catch (error) {
        if (generation !== selectionGeneration) return
        if (
          isAstralBeamApiError(error) &&
          error.status === 409 &&
          error.body?.detail === "This turn has finished. Queue your message as a new turn"
        ) {
          entry.mode = "queue"
          entry.status = "queued"
          entry.key = newUuid()
          entry.steeringFallback = true
          entry.turnMessageId = undefined
        } else {
          if (
            !attempted &&
            isAstralBeamApiError(error) &&
            [400, 403, 404, 413, 429].includes(error.status)
          )
            entry.status = "queued"
          update({ queuePaused: true })
          reportError(error)
        }
      } finally {
        publishQueue()
      }
    })().finally(() => steeringRequests.delete(entry))
    steeringRequests.set(entry, request)
    return request
  }
  async function drainQueue(): Promise<void> {
    if (draining) return
    const generation = selectionGeneration
    draining = true
    try {
      while (
        generation === selectionGeneration &&
        !state.queuePaused &&
        !queueHolds.size &&
        !turnBusy() &&
        state.history === "idle" &&
        state.auth.status === "ready" &&
        !state.error
      ) {
        const entry = pendingMessages.find((entry) => entry.status !== "accepted")
        if (!entry) return
        if (
          entry.attachmentsRequired ||
          state.thread?.role === "viewer" ||
          state.thread?.agentId === null
        ) {
          update({ queuePaused: true })
          return
        }
        if (entry.mode === "steer") {
          await dispatchSteering(entry)
          if (entry.status === "accepted") continue
          if (entry.mode === "steer") return
        }
        const outcome = await submitMessage(entry.content, pendingCallbacks.get(entry.id), entry)
        if (outcome.phase !== "accepted") {
          update({ queuePaused: true })
          return
        }
      }
    } finally {
      draining = false
    }
  }
  const sendMessage: AstralBeamChatCore["sendMessage"] = async (content, callbacks, options) => {
    if (
      submission?.phase === "failed" ||
      state.thread?.role === "viewer" ||
      state.thread?.agentId === null ||
      state.history === "failed"
    )
      return submitMessage(content, callbacks)
    if (!turnBusy() && !pendingMessages.length && !queueHolds.size && state.history !== "loading")
      return submitMessage(content, callbacks)
    const entry: PendingChatMessage = {
      id: newUuid(),
      content,
      mode: "queue",
      status: "queued",
      attachmentsRequired: false,
    }
    pendingMessages.push(entry)
    pendingCallbacks.set(entry.id, callbacks)
    publishQueue()
    notifySubmission(callbacks?.onQueued)
    if (options?.whenBusy === "steer" && state.activeTurnId) await dispatchSteering(entry)
    return { id: entry.id, content, phase: "queued" }
  }

  const observeAuthentication = () => {
    const auth = authenticationState(authentication)
    const previous = state.auth
    if (auth.status === "ready") {
      const nextIdentity = authenticationIdentity(auth.currentUser)
      if (identity !== undefined && identity !== nextIdentity) {
        releaseSubmission("The account changed before this was sent.")
        submissions.clear()
        pendingCallbacks.clear()
        threadToolResults.clear()
        toolResults.clear()
      }
      identity = nextIdentity
      const nextThreadKey = `astralbeam:thread:${live.apiUrl ?? DEFAULT_API_URL}:${nextIdentity}`
      if (threadKey !== nextThreadKey) {
        // The first identity has nothing to clear, so a send made before it resolves continues.
        if (threadKey !== undefined) changeSelection()
        threadKey = nextThreadKey
        const savedClient = selectedThread(`${nextThreadKey}:client`)
        clientId =
          savedClient &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(savedClient)
            ? savedClient
            : newUuid()
        selectedThread(`${nextThreadKey}:client`, clientId)
        if (startWithNewThread) {
          selectedThread(nextThreadKey, null)
          startWithNewThread = false
        } else {
          selectConfiguredThread(true)
        }
        restoreQueue()
      }
      if (capabilityIdentity !== nextIdentity) {
        capabilityIdentity = nextIdentity
        void resolveCapabilities()
      }
    }
    update({ auth })
    if (auth.status === "error" && (previous.status !== "error" || previous.error !== auth.error))
      live.streamCallbacks?.onError?.(auth.error)
  }
  const start = () => {
    if (started) return
    started = true
    const interruptedHydration = requestController.signal.aborted && client.getIsHydrating()
    client.updateOptions({ tools: declareTools() })
    if (requestController.signal.aborted) requestController = new AbortController()
    unsubscribeAuthentication = subscribeAuthentication(authentication, observeAuthentication)
    observeAuthentication()
    stopAuthentication = startAuthentication(authentication)
    if (interruptedHydration) replaceClient(client.getSnapshot().messages)
    else attachClient()
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
        releaseSubmission("The chat service changed before this was sent.")
        submissions.clear()
        pendingCallbacks.clear()
        threadToolResults.clear()
        toolResults.clear()
        changeSelection()
        threadKey = undefined
        observeAuthentication()
      } else if (live.threadId !== selectedId) {
        selectConfiguredThread()
      }
      if (widgets !== live.widgets || onRenderWidget !== live.onRenderWidget)
        restoreCompletedWidgets(state.messages)
      if (started && (live.agentId !== agent || live.apiUrl !== apiUrl)) void resolveCapabilities()
    },
    sendMessage,
    retry,
    editPendingMessage: (id, content) => {
      const entry = pendingMessages.find((entry) => entry.id === id)
      if (
        !entry ||
        entry.status === "accepted" ||
        (entry.status === "sending" &&
          (!entry.attachmentsRequired ||
            pendingMessageText(content) !== pendingMessageText(entry.content)))
      )
        return false
      entry.content =
        typeof content === "string" &&
        typeof entry.content !== "string" &&
        Array.isArray(entry.content.content)
          ? {
              content: [
                ...entry.content.content.filter((part) => part.type !== "text"),
                { type: "text", content },
              ],
            }
          : content
      if (
        typeof content !== "string" &&
        Array.isArray(content.content) &&
        content.content.some((part) => part.type !== "text")
      )
        entry.attachmentsRequired = false
      if (submission?.id === id && submission.phase === "refused") {
        submission.content = entry.content
        update({ submission: project(submission) })
      }
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
      const entry = pendingMessages.find((entry) => entry.id === id && entry.status === "queued")
      if (entry && state.activeTurnId && !queueHolds.size) await dispatchSteering(entry)
    },
    resumeQueue: async () => {
      update({ queuePaused: false, error: undefined })
      await drainQueue()
    },
    holdQueue: () => {
      const hold = Symbol()
      queueHolds.add(hold)
      return () => {
        queueHolds.delete(hold)
        void drainQueue()
      }
    },
    addToolResult,
    // Stop ends the active attempt: a never-dispatched input returns to its sender, and one the
    // server may have stays failed with its key for Retry.
    stop: () => {
      update({ queuePaused: true, activeTurnId: undefined, activeTurnState: "interrupted" })
      delivering = undefined
      toolExecutionGeneration++
      if (submission?.phase === "submitting") endUnaccepted(submission)
      client.stop()
    },
    retryAuthentication: () => {
      void getValidChatAuthToken({ ...authentication, force: true }).catch(() => undefined)
    },
    reload: async () => {
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
    refreshThread: () => refreshThread(),
    loadOlderMessages,
    uploadAttachment: async ({ data, filename, mimeType }) => {
      const agentId = state.thread ? state.thread.agentId : live.agentId
      const [encoded, options] = await Promise.all([data, requestOptions(false)])
      return uploadChatFile(
        {
          ...(agentId ? { agentId } : {}),
          type: mimeType.startsWith("image/") ? "image" : "document",
          source: { type: "data", value: encoded, mimeType },
          metadata: { filename },
        },
        options,
      )
    },
    getThreadAttachment: async (params, options) => {
      if (!params.threadId && !options?.preview)
        throw new Error("A conversation ID is required to download files.")
      return (
        await getThreadAttachment(params, {
          ...(await requestOptions(!!params.threadId || !options?.preview)),
          cache: "default",
          headers: options?.preview ? { "X-File-Preview": "true" } : {},
        })
      ).blob()
    },
    getMcpCatalog: async () => personalMcpGetCatalog(await requestOptions(false)),
    manageMcpConnection: async (operation) => {
      const result = await manageMcpConnection(operation, await requestOptions(false))
      if ("id" in operation) clearUnavailableMcpConnection(operation.id)
      else if (result && "id" in result) clearUnavailableMcpConnection(result.id)
      return result
    },
    authorizeMcpConnection: async (input) => {
      const id = await authorizeMcpConnection(input, () => requestOptions(false))
      clearUnavailableMcpConnection(id)
    },
    abandonToolCall,
    reset: () => {
      debug?.("status", "conversation reset")
      newThread()
    },
    dispose: () => {
      if (!started && requestController.signal.aborted) return
      update({ queuePaused: true })
      publishQueue()
      releaseSubmission("The chat closed before this was sent.")
      unsubscribeSnapshot?.()
      unsubscribeSnapshot = undefined
      client.detach()
      disposeRenders()
      client.stop()
      requestController.abort()
      selectionGeneration++
      capabilitiesGeneration++
      capabilityIdentity = undefined
      stopAuthentication?.()
      unsubscribeAuthentication?.()
      disposeChatAuthentication(authentication)
      started = false
      // React Strict Mode immediately restarts a committed session. Dispose the client only if
      // that restart did not happen: https://react.dev/reference/react/useEffect#caveats
      queueMicrotask(() => {
        if (!started) {
          client.dispose()
          threadKey = undefined
          messagePresentation.clear()
          projectedMessages = new WeakMap()
        }
      })
      listeners.clear()
    },
  }
}
