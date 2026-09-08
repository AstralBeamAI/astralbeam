import {
  ChatClient,
  type ChatClientState,
  fetchServerSentEvents,
  type MultimodalContent,
  type UIMessage,
} from "@tanstack/ai-client"
import type { StreamChunk } from "@tanstack/ai/client"
import { DEFAULT_CHAT_AUTH_TOKEN_URL } from "../lib/constants.ts"
import { getChatConfig, getRunChatUrl } from "../api/generated/api.ts"
import { astralBeamChatFetch, resolveApiUrl } from "../api/api.ts"
import { createDebugLogger } from "../lib/debug.ts"
import type { MountAstralBeamChatOptions } from "../lib/types.ts"
import { buildAgentTools, type WidgetDeclaration } from "./agent-tools.ts"
import {
  type ChatAuthenticationOptions,
  type ChatAuthenticationState,
  disposeChatAuthentication,
  fetchAuthenticatedChat,
  getValidChatAuthToken,
  initializeChatAuthentication,
} from "./auth.ts"
import { isSettledToolCall } from "./messages.ts"
import { ASK_QUESTIONNAIRE_TOOL, SANDBOX_STATUS_EVENT } from "./protocol.ts"
import { collectSandboxActivity } from "./sandbox.ts"
import { validateParameters } from "./schema.ts"
import type { RenderWidgetInput, SandboxActivity, SandboxStatus } from "./types.ts"

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

/**
 * The transport and tool options of the drop-in widget, minus everything about its UI, plus this
 * session's own rendering hooks. The shared options are documented on `MountAstralBeamChatOptions`.
 */
export interface AstralBeamChatCoreOptions extends
  Pick<
    MountAstralBeamChatOptions,
    "agentId" | "apiUrl" | "fetchAstralBeamToken" | "tools" | "debug"
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
export const CORE_OPTION_KEYS = Object.keys(
  {
    agentId: true,
    apiUrl: true,
    fetchAstralBeamToken: true,
    tools: true,
    widgets: true,
    onRenderWidget: true,
    streamCallbacks: true,
    debug: true,
  } satisfies Record<keyof AstralBeamChatCoreOptions, true>,
) as ReadonlyArray<keyof AstralBeamChatCoreOptions>

/** One tool as declared to the agent: its name, and the `metadata.title` that labels it. */
export interface AgentToolInfo {
  name: string
  title: string | undefined
}

function sameAgentTools(
  current: readonly AgentToolInfo[],
  next: readonly AgentToolInfo[],
): boolean {
  return current.length === next.length &&
    current.every((tool, index) =>
      tool.name === next[index]?.name && tool.title === next[index]?.title
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
}

export interface AstralBeamChatCore {
  getState: () => AstralBeamChatState
  /** Notifies on every state change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /**
   * Merges option changes into the session and applies them in place, keeping the transcript and
   * the chat session. Only the keys given are replaced.
   */
  updateOptions: (options: Partial<AstralBeamChatCoreOptions>) => void
  /** Sends a message, first settling any dangling tool calls so the run can proceed. */
  sendMessage: (content: string | MultimodalContent) => Promise<void>
  /** Resolves a client tool call the host executed itself (a questionnaire, an approval). */
  addToolResult: ChatClient["addToolResult"]
  /** Stops the in-flight generation; the transcript keeps what already streamed. */
  stop: () => void
  /** Mints a fresh chat auth token, ignoring the cached one; for a retry after a failure. */
  retryAuthentication: () => void
  /** Re-runs the last exchange. */
  reload: () => Promise<void>
  /** Clears the conversation and disposes live widget renders. */
  reset: () => void
  /** Tears the session down: the connection, authentication, and widget renders. */
  dispose: () => void
}

/**
 * The headless AstralBeam chat session: authentication, transport, the tool protocol, and
 * transcript state, with no markup. The drop-in widget is one consumer; a host that owns its
 * whole UI is another.
 */
export function createAstralBeamChat(options: AstralBeamChatCoreOptions): AstralBeamChatCore {
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
  }
  const update = (next: Partial<AstralBeamChatState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  const authentication: ChatAuthenticationOptions = {
    fetchAstralBeamToken: live.fetchAstralBeamToken ?? { url: DEFAULT_CHAT_AUTH_TOKEN_URL },
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: (auth) => update({ auth }),
    fetchClient: globalThis.fetch.bind(globalThis),
    debug,
  }
  void initializeChatAuthentication(authentication).catch(() => undefined)

  // Agent capability handshake; fails open for state (the endpoint still enforces its policy).
  // Generation-checked, so a slower response for a superseded agent or API base is dropped
  // instead of overwriting the grant resolved for the current one.
  let capabilitiesGeneration = 0
  const resolveCapabilities = async () => {
    const generation = ++capabilitiesGeneration
    try {
      const token = await getValidChatAuthToken(authentication)
      const body = await getChatConfig(live.agentId ? { agentId: live.agentId } : {}, {
        apiUrl: live.apiUrl,
        astralBeamToken: token,
      })
      if (generation !== capabilitiesGeneration) return
      const attachments = body.capabilities?.attachments !== false
      update({ capabilities: { attachments } })
      debug?.("mount", "agent capabilities resolved", { attachments })
    } catch (error) {
      debug?.("error", "agent capabilities could not be resolved; keeping the defaults", error)
    }
  }
  void resolveCapabilities()

  // Live widget renders, keyed per tool call like the styled widget's, so a repeated call
  // replaces its own render and a reset disposes them all.
  const renderCleanups = new Map<string, () => void>()
  const disposeRenders = () => {
    for (const cleanup of renderCleanups.values()) cleanup()
    renderCleanups.clear()
  }
  const renderWidget = async (input: RenderWidgetInput, toolCallId: string) => {
    const widgets = live.widgets ?? {}
    if (!Object.hasOwn(widgets, input.widget)) {
      throw new Error(`Unknown widget "${input.widget}"`)
    }
    const declaration = widgets[input.widget]
    const validated = await validateParameters(declaration?.parameters, input.props ?? {})
    if (validated == null) {
      throw new Error(`Props for widget "${input.widget}" failed validation`)
    }
    renderCleanups.get(toolCallId)?.()
    renderCleanups.delete(toolCallId)
    // Compared by identity, so a late release cannot forget the cleanup of a newer render that
    // has meanwhile taken over the same tool call.
    let registered: (() => void) | undefined
    const release = () => {
      if (renderCleanups.get(toolCallId) === registered) renderCleanups.delete(toolCallId)
    }
    const cleanup = live.onRenderWidget?.({
      widget: input.widget,
      props: validated,
      toolCallId,
      release,
    })
    if (cleanup) {
      registered = cleanup
      renderCleanups.set(toolCallId, cleanup)
    }
    return { widget: input.widget, rendered: live.onRenderWidget !== undefined }
  }

  const buildTools = () =>
    buildAgentTools(live.widgets ?? {}, live.tools ?? {}, renderWidget, debug)
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
  const forwardedProps = () => ({
    ...(live.agentId ? { agentId: live.agentId } : {}),
    ...(live.debug ? { debug: true } : {}),
  })

  const client = new ChatClient({
    // A URL getter, because the client reads its connection once and a second client would cost
    // the transcript.
    connection: fetchServerSentEvents(
      () => resolveApiUrl(getRunChatUrl(), live.apiUrl),
      async () => {
        const token = await getValidChatAuthToken(authentication)
        return {
          fetchClient: (_input, init) =>
            astralBeamChatFetch(getRunChatUrl(), {
              ...init,
              apiUrl: live.apiUrl,
              astralBeamToken: token,
              fetchClient: (input, request) =>
                fetchAuthenticatedChat({ ...authentication, input, init: request }),
            }),
        }
      },
    ),
    tools: declareTools(),
    forwardedProps: forwardedProps(),
    onMessagesChange: (messages) => {
      update({ messages, sandbox: collectSandboxActivity(messages), error: client.getError() })
    },
    onStatusChange: (status) => update({ status, error: client.getError() }),
    onCustomEvent: (eventType, data) => {
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
    onChunk: (chunk) => live.streamCallbacks?.onChunk?.(chunk),
    onResponse: (response) => live.streamCallbacks?.onResponse?.(response),
    onFinish: (message) => live.streamCallbacks?.onFinish?.(message),
    onError: (error) => live.streamCallbacks?.onError?.(error),
  })

  // A run input holding an unresolved tool call never reaches the model, so a send settles
  // every dangling call first: questionnaires as skipped, unknown tools as errors.
  const settleDanglingToolCalls = () => {
    for (const message of state.messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || isSettledToolCall(part)) continue
        if (part.name === ASK_QUESTIONNAIRE_TOOL) {
          debug?.("questionnaire", "skipping pending questionnaire before send", { id: part.id })
          void client.addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: { answers: [], skipped: true },
          })
        } else {
          debug?.("tool", `settling unimplemented tool call "${part.name}" as error`, {
            id: part.id,
          })
          void client.addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: null,
            state: "output-error",
            errorText: `The application hosting this chat has no implementation for "${part.name}"`,
          })
        }
      }
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    updateOptions: (next) => {
      const agent = live.agentId
      const apiUrl = live.apiUrl
      live = { ...live, ...next }
      debug = createDebugLogger(live.debug)
      authentication.fetchAstralBeamToken = live.fetchAstralBeamToken ??
        { url: DEFAULT_CHAT_AUTH_TOKEN_URL }
      authentication.debug = debug
      client.updateOptions({ tools: declareTools(), forwardedProps: forwardedProps() })
      if (live.agentId !== agent || live.apiUrl !== apiUrl) void resolveCapabilities()
    },
    sendMessage: (content) => {
      settleDanglingToolCalls()
      return client.sendMessage(content)
    },
    addToolResult: (result) => client.addToolResult(result),
    stop: () => client.stop(),
    retryAuthentication: () => {
      void getValidChatAuthToken({ ...authentication, force: true }).catch(() => undefined)
    },
    reload: () => client.reload(),
    reset: () => {
      debug?.("status", "conversation reset")
      client.clear()
      disposeRenders()
      update({
        messages: [],
        sandbox: { files: [], commands: [] },
        sandboxStatus: undefined,
        error: undefined,
      })
    },
    dispose: () => {
      disposeRenders()
      client.dispose()
      disposeChatAuthentication(authentication)
      listeners.clear()
    },
  }
}
