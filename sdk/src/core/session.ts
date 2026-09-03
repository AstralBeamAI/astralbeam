import {
  ChatClient,
  type ChatClientState,
  fetchServerSentEvents,
  type MultimodalContent,
  type UIMessage,
} from "@tanstack/ai-client"
import { chatApiUrls, DEFAULT_AUTH_TOKEN_URL } from "../lib/constants.ts"
import { createDebugLogger } from "../lib/debug.ts"
import type { AstralBeamChatAuthTokenHeaders, ToolDefinition } from "../lib/types.ts"
import { buildAgentTools, type WidgetDeclaration } from "./agent-tools.ts"
import {
  type ChatAuthenticationOptions,
  type ChatAuthenticationState,
  disposeChatAuthentication,
  fetchAuthenticatedChat,
  getValidChatToken,
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
}

export interface AstralBeamChatCoreOptions {
  /** Public ID of the organization-owned agent; omitted, the organization's default answers. */
  agentId?: string | undefined
  /** Base URL of the AstralBeam API; `/chat` hangs off it. Default the hosted cloud. */
  apiUrl?: string | undefined
  /** The application endpoint that mints short-lived chat JWTs. Default `/api/astralbeam/token`. */
  authTokenUrl?: string | undefined
  /**
   * Extra headers for the token request, for a backend on another origin that authenticates with a
   * bearer token or custom header instead of cookies. Resolved on every token request, so pass the
   * function form for a credential that rotates.
   */
  authTokenHeaders?: AstralBeamChatAuthTokenHeaders | undefined
  /** Host tools the agent can call; `execute` runs wherever this session lives. */
  tools?: Record<string, ToolDefinition> | undefined
  /** Widgets declared to the agent; `onRenderWidget` is asked to draw them. */
  widgets?: Record<string, WidgetDeclaration> | undefined
  /** Draws an agent-requested widget however the host wants; may return a cleanup. */
  onRenderWidget?: ((request: WidgetRenderRequest) => (() => void) | void) | undefined
  /** Logs every action to the console and asks the endpoint to log its side too. */
  debug?: boolean | undefined
}

export interface AstralBeamChatState {
  messages: UIMessage[]
  /** The underlying chat client status: "ready", "submitted", "streaming", or "error". */
  status: ChatClientState
  error: Error | undefined
  auth: ChatAuthenticationState
  /** What the resolved agent grants; the UI should render only that. */
  capabilities: { attachments: boolean }
  sandboxStatus: SandboxStatus | undefined
  sandbox: SandboxActivity
}

export interface AstralBeamChatCore {
  getState: () => AstralBeamChatState
  /** Notifies on every state change; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
  /** Sends a message, first settling any dangling tool calls so the run can proceed. */
  sendMessage: (content: string | MultimodalContent) => Promise<void>
  /** Resolves a client tool call the host executed itself (a questionnaire, an approval). */
  addToolResult: ChatClient["addToolResult"]
  /** Stops the in-flight generation; the transcript keeps what already streamed. */
  stop: () => void
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
  const debug = createDebugLogger(options.debug)
  const urls = chatApiUrls(options.apiUrl)
  const widgets = options.widgets ?? {}
  const listeners = new Set<() => void>()
  let state: AstralBeamChatState = {
    messages: [],
    status: "ready",
    error: undefined,
    auth: { status: "loading" },
    capabilities: { attachments: true },
    sandboxStatus: undefined,
    sandbox: { files: [], commands: [] },
  }
  const update = (next: Partial<AstralBeamChatState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  const authentication: ChatAuthenticationOptions = {
    authTokenUrl: options.authTokenUrl ?? DEFAULT_AUTH_TOKEN_URL,
    authTokenHeaders: options.authTokenHeaders,
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
  void (async () => {
    try {
      const url = new URL(urls.config, globalThis.location?.href)
      if (options.agentId) url.searchParams.set("agentId", options.agentId)
      const token = await getValidChatToken(authentication)
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error(`The config request answered ${response.status}`)
      const body = await response.json() as { capabilities?: { attachments?: unknown } }
      update({ capabilities: { attachments: body.capabilities?.attachments !== false } })
    } catch (error) {
      debug?.("error", "agent capabilities could not be resolved; keeping the defaults", error)
    }
  })()

  // Live widget renders, keyed per tool call like the styled widget's, so a repeated call
  // replaces its own render and a reset disposes them all.
  const renderCleanups = new Map<string, () => void>()
  const disposeRenders = () => {
    for (const cleanup of renderCleanups.values()) cleanup()
    renderCleanups.clear()
  }
  const renderWidget = async (input: RenderWidgetInput, toolCallId: string) => {
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
    const cleanup = options.onRenderWidget?.({ widget: input.widget, props: validated, toolCallId })
    if (cleanup) renderCleanups.set(toolCallId, cleanup)
    return { widget: input.widget, rendered: options.onRenderWidget !== undefined }
  }

  const client = new ChatClient({
    connection: fetchServerSentEvents(urls.chat, async () => ({
      headers: { authorization: `Bearer ${await getValidChatToken(authentication)}` },
      fetchClient: (input, init) => fetchAuthenticatedChat({ ...authentication, input, init }),
    })),
    tools: buildAgentTools(widgets, options.tools ?? {}, renderWidget, debug),
    forwardedProps: {
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.debug ? { debug: true } : {}),
    },
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
        update({ sandboxStatus: value })
        return
      }
      debug?.("stream", `custom event "${eventType}"`, data)
    },
  })

  // A run input holding an unresolved tool call never reaches the model, so a send settles
  // every dangling call first: questionnaires as skipped, unknown tools as errors.
  const settleDanglingToolCalls = () => {
    for (const message of state.messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || isSettledToolCall(part)) continue
        if (part.name === ASK_QUESTIONNAIRE_TOOL) {
          void client.addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: { answers: [], skipped: true },
          })
        } else {
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
    sendMessage: (content) => {
      settleDanglingToolCalls()
      return client.sendMessage(content)
    },
    addToolResult: (result) => client.addToolResult(result),
    stop: () => client.stop(),
    reload: () => client.reload(),
    reset: () => {
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
