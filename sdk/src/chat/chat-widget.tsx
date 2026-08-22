import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  StopIcon,
} from "@phosphor-icons/react"
import type { UIMessage } from "@tanstack/ai-client"
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import { AssistantPart } from "../components/assistant-part.tsx"
import { PartErrorBoundary } from "../components/part-error-boundary.tsx"
import { UserMessageBody } from "../components/user-message-body.tsx"
import { DEFAULT_ENDPOINT, DEFAULT_TITLE } from "../lib/client-constants.ts"
import type { MountAstralBeamChatOptions } from "../lib/client-types.ts"
import { createDebugLogger } from "../lib/client-utils.ts"
import { ASK_QUESTIONNAIRE_TOOL, MAX_ACTIVE_WIDGET_RENDERS } from "../lib/constants.ts"
import { createChunkLogger } from "../lib/debug.ts"
import type { RenderWidgetInput } from "../lib/types.ts"
import {
  describeError,
  getWidget,
  isSettledToolCall,
  slotNameForToolCall,
  validateParameters,
} from "../lib/utils.ts"
import { buildAskQuestionnaireTool, buildHostTools, buildRenderWidgetTool } from "./agent.ts"

interface ActiveWidgetRender {
  /** Kept so an update that drops the widget can dispose renders it can no longer resolve. */
  widget: string
  container: HTMLElement
  cleanup: (() => void) | undefined
}

function disposeWidgetRender({ container, cleanup }: ActiveWidgetRender) {
  cleanup?.()
  container.remove()
}

export function ChatWidget(
  { options, host }: { options: MountAstralBeamChatOptions; host: HTMLElement },
) {
  const widgets = options.widgets ?? {}
  // Slot names whose light-DOM container currently holds a live widget render; the
  // transcript renders a real <slot> only for these, a summary marker otherwise.
  const [activeSlots, setActiveSlots] = useState<ReadonlySet<string>>(new Set())
  // Keyed by tool call, not by widget, so a listing that renders one widget per item keeps
  // every card alive; only a repeat of the same call replaces its own render.
  const activeRenders = useRef(new Map<string, ActiveWidgetRender>())
  // Reset, the active-render cap, and cleanup after a widget is unregistered differ only in which
  // renders they select, so they share one path: dispose, forget, and drop the slot so the
  // transcript entry falls back to a summary marker. Returns how many went.
  const discardRenders = (discard: (render: ActiveWidgetRender) => boolean) => {
    const dropped: string[] = []
    // Deleting the current entry while iterating a Map is well defined, and insertion order makes
    // a size-based predicate discard oldest-first.
    for (const [toolCallId, render] of activeRenders.current) {
      if (!discard(render)) continue
      disposeWidgetRender(render)
      activeRenders.current.delete(toolCallId)
      dropped.push(slotNameForToolCall(toolCallId))
    }
    if (dropped.length > 0) {
      setActiveSlots((current) => {
        const next = new Set(current)
        for (const slot of dropped) next.delete(slot)
        return next
      })
    }
    return dropped.length
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discardRenders(() => true)
    }
  }, [])

  const debug = useMemo(() => createDebugLogger(options.debug), [options.debug])
  // `renderWidget` has to stay referentially stable or the tool set below would rebuild on every
  // render, so it reads the widgets and the logger through refs instead of capturing them: a
  // render can be requested many turns after the update that declared the widget.
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets
  const debugRef = useRef(debug)
  debugRef.current = debug

  const renderWidget = useCallback(
    async ({ widget, props }: RenderWidgetInput, toolCallId: string) => {
      const debug = debugRef.current
      debug?.("widget", `agent requested widget "${widget}"`, { toolCallId, props })
      const definition = getWidget(widgetsRef.current, widget)
      if (!definition) throw new Error(`Unknown widget "${widget}"`)
      const validated = await validateParameters(definition.parameters, props ?? {})
      if (validated == null) {
        debug?.("error", `props for widget "${widget}" failed validation`, { props })
        throw new Error(`Props for widget "${widget}" failed validation`)
      }
      if (!mounted.current) throw new Error("The chat is no longer mounted")
      const slotName = slotNameForToolCall(toolCallId)
      const previous = activeRenders.current.get(toolCallId)
      if (previous) {
        debug?.("widget", `replacing previous render of "${widget}"`, { toolCallId })
        disposeWidgetRender(previous)
      }
      // The container is a light-DOM child of the shadow host, so the <slot> rendered
      // in the transcript projects it into the conversation.
      const container = document.createElement("div")
      container.slot = slotName
      host.append(container)
      const cleanup = definition.render(validated, container)
      activeRenders.current.set(toolCallId, { widget, container, cleanup: cleanup ?? undefined })
      // Deleting the current entry while iterating a Map is well defined, and insertion order
      // makes this evict oldest-first; their transcript entries collapse to a summary marker.
      const evicted = discardRenders(() => activeRenders.current.size > MAX_ACTIVE_WIDGET_RENDERS)
      if (evicted > 0) {
        debug?.("widget", `evicted ${evicted} widget render(s) past the active cap`, {
          cap: MAX_ACTIVE_WIDGET_RENDERS,
        })
      }
      setActiveSlots((current) => new Set(current).add(slotName))
      debug?.("widget", `widget "${widget}" rendered`, { slotName })
      return { widget, rendered: true }
    },
    [host],
  )

  // Rebuilt whenever the declared surface changes: `render_widget` carries the widget catalog in
  // its description, and a host tool's schema and `execute` are captured per definition. useChat
  // pushes a new array through `client.updateOptions`, so the next run sees the current set.
  const tools = useMemo(() => [
    ...(Object.keys(widgets).length > 0 ? [buildRenderWidgetTool(widgets, renderWidget)] : []),
    buildAskQuestionnaireTool(),
    ...buildHostTools(options.tools ?? {}, debug),
  ], [widgets, options.tools, debug, renderWidget])
  const toolNames = useMemo(() => new Set(tools.map((tool) => tool.name)), [tools])
  useEffect(() => {
    debug?.("mount", "tool set declared to the agent", {
      tools: [...toolNames],
      widgets: Object.keys(widgetsRef.current),
    })
  }, [debug, toolNames])

  // A widget dropped by an update leaves its render unreachable: the transcript can no longer
  // resolve the definition, so the container would linger in the host's DOM behind a slot that
  // is never rendered. Those entries fall back to the summary marker instead.
  useEffect(() => {
    const orphaned = discardRenders((render) => !getWidget(widgets, render.widget))
    if (orphaned > 0) {
      debug?.("widget", `disposed ${orphaned} render(s) of widgets no longer registered`)
    }
  }, [widgets, debug])

  // Fixed for the mount, which is why `endpoint` is not part of an update: useChat reads the
  // connection only when it constructs its client, so a new one would cost the transcript.
  const [connection] = useState(() => fetchServerSentEvents(options.endpoint ?? DEFAULT_ENDPOINT))
  const debugCallbacks = useMemo(
    () =>
      debug && {
        onChunk: createChunkLogger(debug),
        onResponse: (response?: Response) =>
          debug(
            "run",
            response ? `endpoint responded with HTTP ${response.status}` : "request sent",
          ),
        onFinish: (message: UIMessage) => debug("run", "assistant turn finished", message),
        onError: (chatError: Error) => debug("error", chatError.message, chatError),
      },
    [debug],
  )
  // `debug: true` rides along in the forwarded props so the endpoint logs its side too. Always
  // passed, even when empty: useChat skips an undefined value, so omitting it would leave a
  // previously forwarded `debug` in place after the host turns it back off.
  const forwardedProps = useMemo(() => ({
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.debug ? { debug: true } : {}),
  }), [options.systemPrompt, options.debug])
  const { messages, sendMessage, setMessages, status, error, addToolResult, stop, reload } =
    useChat({
      initialMessages: [],
      connection,
      tools,
      forwardedProps,
      ...(debugCallbacks || {}),
    })
  useEffect(() => {
    debug?.("status", `chat status is "${status}"`)
  }, [debug, status])
  const [draft, setDraft] = useState("")
  const streamBusy = status === "submitted" || status === "streaming"
  // A busy stream can be silent for a while (server-side reasoning, follow-ups after
  // tool results), so "Thinking…" shows until some part visibly makes progress.
  const lastMessage = messages.at(-1)
  const lastPart = lastMessage?.role === "assistant" ? lastMessage.parts.at(-1) : undefined
  const lastPartInProgress = lastPart != null && (
    ((lastPart.type === "text" || lastPart.type === "thinking") &&
      lastPart.content.length > 0) ||
    (lastPart.type === "tool-call" && !isSettledToolCall(lastPart))
  )
  const awaitingReply = streamBusy && !lastPartInProgress
  // Host tools execute between runs with status "ready". A send in that window ships
  // their call unresolved: the endpoint re-offers the pending tool instead of calling
  // the model, the message goes unanswered, and the redelivered call can re-execute a
  // side-effecting tool — so those windows count as busy too. Questionnaires and calls
  // to tools this mount never implemented stay interactive: sendDraft settles them.
  const pendingToolRun = messages.some((message) =>
    message.parts.some((part) =>
      part.type === "tool-call" && !isSettledToolCall(part) &&
      part.name !== ASK_QUESTIONNAIRE_TOOL && toolNames.has(part.name)
    )
  )
  const isBusy = streamBusy || pendingToolRun

  // A run input holding an unresolved tool call never reaches the model — the endpoint
  // re-offers the pending tool and finishes, leaving the message unanswered — so a send
  // settles every dangling call first: questionnaires as skipped, unknown tools as
  // errors. The resolution may auto-resume the run; this message then queues behind it.
  const settleDanglingToolCalls = () => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || isSettledToolCall(part)) continue
        if (part.name === ASK_QUESTIONNAIRE_TOOL) {
          debug?.("questionnaire", "skipping pending questionnaire before send", { id: part.id })
          void addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: { answers: [], skipped: true },
          })
        } else {
          debug?.("tool", `settling unimplemented tool call "${part.name}" as error`, {
            id: part.id,
          })
          void addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: null,
            state: "output-error",
            errorText: `The page hosting this chat has no implementation for "${part.name}"`,
          })
        }
      }
    }
  }

  const sendDraft = () => {
    const text = draft.trim()
    if (isBusy || text.length === 0) return
    settleDanglingToolCalls()
    debug?.("send", text)
    void sendMessage(text)
    setDraft("")
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="font-semibold">{options.title ?? DEFAULT_TITLE}</div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset conversation"
          disabled={streamBusy || messages.length === 0}
          onClick={() => {
            debug?.("status", "conversation reset")
            setMessages([])
            setDraft("")
            discardRenders(() => true)
          }}
        >
          <ArrowCounterClockwiseIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1">
        {messages.length === 0
          ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ChatCircleDotsIcon />
                </EmptyMedia>
                <EmptyTitle>Ask the assistant</EmptyTitle>
                <EmptyDescription>
                  It can answer questions and act through this app's own tools and widgets.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
          : (
            /* autoScroll with no scroll anchors keeps the newest content at the bottom. The
             * alternative, anchoring each user message to the top, grows a spacer sized to make
             * that scroll position reachable, which reads as dead space whenever the reply is
             * shorter than the viewport — common in a narrow sidebar. */
            <MessageScrollerProvider autoScroll>
              <MessageScroller className="h-full">
                <MessageScrollerViewport>
                  <MessageScrollerContent aria-busy={isBusy} className="p-3">
                    {messages.map((message) => (
                      <MessageScrollerItem key={message.id} messageId={message.id}>
                        <Message align={message.role === "user" ? "end" : "start"}>
                          <MessageContent>
                            {message.role === "user"
                              ? <UserMessageBody message={message} />
                              : message.parts.map((part, partIndex) => (
                                <PartErrorBoundary key={partIndex}>
                                  <AssistantPart
                                    part={part}
                                    widgets={widgets}
                                    activeSlots={activeSlots}
                                    onQuestionnaireAnswers={(toolCallId, answers) => {
                                      debug?.("questionnaire", "answers submitted", {
                                        toolCallId,
                                        answers,
                                      })
                                      void addToolResult({
                                        toolCallId,
                                        tool: ASK_QUESTIONNAIRE_TOOL,
                                        output: { answers },
                                      })
                                    }}
                                  />
                                </PartErrorBoundary>
                              ))}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                    {awaitingReply && (
                      <MessageScrollerItem messageId="astralbeam-thinking">
                        <Marker role="status">
                          {/* No `shimmer` here or on tool-call labels: see ARCHITECTURE.md. */}
                          <MarkerIcon>
                            <Spinner />
                          </MarkerIcon>
                          <MarkerContent>Thinking…</MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
      </div>
      <form
        className="border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          sendDraft()
        }}
      >
        {status === "error" && (
          <div
            role="alert"
            className="mb-2 flex items-center gap-2 rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive"
          >
            <div className="min-w-0 flex-1">
              <div>{describeError(error)}</div>
              {error?.message && (
                <div className="mt-0.5 truncate text-muted-foreground" title={error.message}>
                  {error.message}
                </div>
              )}
            </div>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void reload()}
              >
                Retry
              </Button>
            )}
          </div>
        )}
        <InputGroup>
          <InputGroupTextarea
            aria-label="Message"
            className="max-h-24 min-h-9"
            placeholder="Message AstralBeam…"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                sendDraft()
              }
            }}
          />
          <InputGroupAddon align="block-end">
            {streamBusy
              ? (
                <InputGroupButton
                  type="button"
                  variant="default"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => {
                    debug?.("status", "generation stopped by user")
                    stop()
                  }}
                >
                  <StopIcon />
                  <span className="sr-only">Stop</span>
                </InputGroupButton>
              )
              : (
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  className="ml-auto"
                  disabled={isBusy || draft.trim().length === 0}
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Send</span>
                </InputGroupButton>
              )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
