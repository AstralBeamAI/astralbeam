import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  StopIcon,
} from "@phosphor-icons/react"
import type { UIMessage } from "@tanstack/ai-client"
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import type { MountAstralBeamChatOptions } from "../client.ts"
import { AssistantPart } from "../components/assistant-part.tsx"
import { PartErrorBoundary } from "../components/part-error-boundary.tsx"
import { UserMessageBody } from "../components/user-message-body.tsx"
import { ASK_QUESTIONNAIRE_TOOL, DEFAULT_ENDPOINT } from "../lib/constants.ts"
import { createChunkLogger, createDebugLogger } from "../lib/debug.ts"
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
  container: HTMLElement
  cleanup: (() => void) | undefined
  slotName: string
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
  // A widget holds at most one active render; a repeated request replaces the previous.
  const activeRenders = useRef(new Map<string, ActiveWidgetRender>())
  const removeActiveRenders = () => {
    activeRenders.current.forEach(disposeWidgetRender)
    activeRenders.current.clear()
    setActiveSlots(new Set())
  }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      removeActiveRenders()
    }
  }, [])

  // The connection and tool set are fixed per mount; widget or tool changes afterwards
  // are not supported yet. The closures read refs, so first-render capture is safe.
  const [session] = useState(() => {
    const debug = createDebugLogger(options.debug)
    const renderWidget = async ({ widget, props }: RenderWidgetInput, toolCallId: string) => {
      debug?.("widget", `agent requested widget "${widget}"`, { toolCallId, props })
      const definition = getWidget(widgets, widget)
      if (!definition) throw new Error(`Unknown widget "${widget}"`)
      const validated = await validateParameters(definition.parameters, props ?? {})
      if (validated == null) {
        debug?.("error", `props for widget "${widget}" failed validation`, { props })
        throw new Error(`Props for widget "${widget}" failed validation`)
      }
      if (!mounted.current) throw new Error("The chat is no longer mounted")
      const slotName = slotNameForToolCall(toolCallId)
      const previous = activeRenders.current.get(widget)
      if (previous) {
        debug?.("widget", `replacing previous render of "${widget}"`)
        disposeWidgetRender(previous)
      }
      // The container is a light-DOM child of the shadow host, so the <slot> rendered
      // in the transcript projects it into the conversation.
      const container = document.createElement("div")
      container.slot = slotName
      host.append(container)
      const cleanup = definition.render(validated, container)
      activeRenders.current.set(widget, { container, cleanup: cleanup ?? undefined, slotName })
      setActiveSlots((current) => {
        const next = new Set(current)
        if (previous) next.delete(previous.slotName)
        next.add(slotName)
        return next
      })
      debug?.("widget", `widget "${widget}" rendered`, { slotName })
      return { widget, rendered: true }
    }
    const tools = [
      ...(Object.keys(widgets).length > 0 ? [buildRenderWidgetTool(widgets, renderWidget)] : []),
      buildAskQuestionnaireTool(),
      ...buildHostTools(options.tools ?? {}, debug),
    ]
    const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
    debug?.("mount", `chat session ready, streaming from ${endpoint}`, {
      endpoint,
      systemPrompt: options.systemPrompt,
      tools: tools.map((tool) => tool.name),
      widgets: Object.keys(widgets),
    })
    return {
      connection: fetchServerSentEvents(endpoint),
      tools,
      toolNames: new Set(tools.map((tool) => tool.name)),
      debug,
      debugCallbacks: debug && {
        onChunk: createChunkLogger(debug),
        onResponse: (response?: Response) =>
          debug(
            "run",
            response ? `endpoint responded with HTTP ${response.status}` : "request sent",
          ),
        onFinish: (message: UIMessage) => debug("run", "assistant turn finished", message),
        onError: (chatError: Error) => debug("error", chatError.message, chatError),
      },
    }
  })
  const debug = session.debug
  // `debug: true` rides along in the forwarded props so the endpoint logs its side too.
  const forwardedProps = {
    ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.debug ? { debug: true } : {}),
  }
  const { messages, sendMessage, setMessages, status, error, addToolResult, stop, reload } =
    useChat({
      initialMessages: [],
      connection: session.connection,
      tools: session.tools,
      ...(Object.keys(forwardedProps).length > 0 ? { forwardedProps } : {}),
      ...(session.debugCallbacks || {}),
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
      part.name !== ASK_QUESTIONNAIRE_TOOL && session.toolNames.has(part.name)
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
        <div>
          <div className="font-semibold">AstralBeam</div>
          <div className="text-xs text-muted-foreground">Assistant</div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset conversation"
          disabled={streamBusy || messages.length === 0}
          onClick={() => {
            debug?.("status", "conversation reset")
            setMessages([])
            setDraft("")
            removeActiveRenders()
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
            <MessageScrollerProvider>
              <MessageScroller className="h-full">
                <MessageScrollerViewport>
                  <MessageScrollerContent aria-busy={isBusy} className="p-3">
                    {messages.map((message) => (
                      <MessageScrollerItem
                        key={message.id}
                        messageId={message.id}
                        scrollAnchor={message.role === "user"}
                      >
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
                          <MarkerContent className="shimmer">Thinking…</MarkerContent>
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
