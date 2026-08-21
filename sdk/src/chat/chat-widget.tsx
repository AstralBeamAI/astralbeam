import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  FileTextIcon,
  StopIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react"
import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react"
import { Component, type ReactNode, useEffect, useRef, useState } from "react"
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
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
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { Spinner } from "@/components/ui/spinner"
import type { MountAstralBeamChatOptions, WidgetDefinition } from "../client.ts"
import {
  ASK_QUESTIONNAIRE_TOOL,
  buildAskQuestionnaireTool,
  buildHostTools,
  buildRenderWidgetTool,
  getMessageText,
  type QuestionnaireAnswer,
  type QuestionnaireItemSpec,
  RENDER_WIDGET_TOOL,
  type RenderWidgetInput,
  sanitizeQuestionnaireItems,
  slotNameForToolCall,
  validateParameters,
} from "./agent.ts"

const DEFAULT_ENDPOINT = "/api/chat"

/** Widget names come from the agent, so inherited keys like "constructor" must not resolve. */
function getWidget(widgets: Record<string, WidgetDefinition>, name: string) {
  return Object.hasOwn(widgets, name) ? widgets[name] : undefined
}

interface ActiveWidgetRender {
  container: HTMLElement
  cleanup: (() => void) | undefined
  slotName: string
}

function disposeWidgetRender({ container, cleanup }: ActiveWidgetRender) {
  cleanup?.()
  container.remove()
}

/**
 * The transcript renders agent-chosen content, so a malformed part must degrade to a placeholder
 * instead of unmounting the whole chat — React tears down the entire tree on an uncaught render
 * error, and there is no other boundary inside the shadow root.
 */
class PartErrorBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <Marker>
        <MarkerIcon>
          <WarningCircleIcon />
        </MarkerIcon>
        <MarkerContent>Part of this response could not be displayed</MarkerContent>
      </Marker>
    )
  }
}

/**
 * A terminal tool call: it failed or produced an output. `state` matters because a tool may
 * legitimately resolve with `null`, which an output-only check would read as still running.
 */
function isSettledToolCall(part: { state: string; output?: unknown }): boolean {
  return part.state === "complete" || part.state === "error" || part.output !== undefined
}

/** Transport errors read like "HTTP error! status: 500"; end users need something actionable. */
function describeError(error: Error | undefined): string {
  const message = error?.message ?? ""
  const httpStatus = message.match(/status: (\d{3})/)?.[1]
  if (httpStatus) return `The assistant service returned an error (HTTP ${httpStatus}).`
  if (/fetch|network|load failed|connection/i.test(message)) {
    return "The assistant service could not be reached. Check your connection."
  }
  return "Something went wrong while talking to the assistant."
}

function UserMessageBody({ message }: { message: UIMessage }) {
  const text = getMessageText(message)
  return (
    <>
      {text.length > 0 && (
        <Bubble>
          <BubbleContent>{text}</BubbleContent>
        </Bubble>
      )}
      {message.parts.map((part, partIndex) => {
        if (part.type !== "document" && part.type !== "image") return null
        const url = part.source.type === "url" ? part.source.value : null
        // TanStack media parts carry no filename, so fall back to the URL basename.
        const title = url?.split("/").at(-1) ?? "Attachment"
        return (
          <Attachment key={partIndex}>
            <AttachmentMedia>
              <FileTextIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{title}</AttachmentTitle>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </>
  )
}

/** Collects submitted questionnaire answers as the structured tool output the agent receives. */
function collectAnswers(items: QuestionnaireItemSpec[], formData: FormData): QuestionnaireAnswer[] {
  return items.map((item) => {
    const values = formData.getAll(item.name).map(String).filter((value) => value.length > 0)
    const labels = values.map(
      (value) => item.choices.find((choice) => choice.value === value)?.label ?? value,
    )
    return { name: item.name, question: item.title, answers: labels }
  })
}

function InlineQuestionnaire(
  { items, onAnswers }: {
    items: QuestionnaireItemSpec[]
    onAnswers: (answers: QuestionnaireAnswer[]) => void
  },
) {
  return (
    <Questionnaire
      className="rounded-xl border bg-card p-4"
      items={items}
      onSubmit={(event) => {
        event.preventDefault()
        onAnswers(collectAnswers(items, new FormData(event.currentTarget)))
      }}
    >
      <QuestionnaireProgress />
      {items.map((item) => (
        <QuestionnaireItem
          key={item.name}
          name={item.name}
          required={item.required ?? false}
          multiple={item.multiple ?? false}
        >
          <QuestionnaireTitle>{item.title}</QuestionnaireTitle>
          {item.description && (
            <QuestionnaireDescription>{item.description}</QuestionnaireDescription>
          )}
          <QuestionnaireChoices>
            {item.choices.map((choice) => (
              <QuestionnaireChoice key={choice.value} value={choice.value}>
                <span className="font-medium">{choice.label}</span>
                {choice.description && (
                  <span className="text-muted-foreground">{choice.description}</span>
                )}
              </QuestionnaireChoice>
            ))}
            {item.input && (
              <QuestionnaireInput
                aria-label={item.input.label}
                placeholder={item.input.placeholder}
              />
            )}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
      ))}
      <QuestionnaireActions>
        <QuestionnairePrevious />
        <QuestionnaireSkip />
        <QuestionnaireNext />
        <QuestionnaireSubmit>Send answers</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}

interface AssistantPartProps {
  part: MessagePart
  widgets: Record<string, WidgetDefinition>
  activeSlots: ReadonlySet<string>
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

function AssistantPart({ part, widgets, activeSlots, onQuestionnaireAnswers }: AssistantPartProps) {
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{part.content}</BubbleContent>
        </Bubble>
      )
    case "thinking":
      return <div className="px-1 text-xs text-muted-foreground italic">{part.content}</div>
    case "tool-call": {
      if (part.state === "error") {
        // Failed client executions store the thrown message as `{ error }` in the output.
        const detail = (part.output as { error?: string } | null | undefined)?.error
        return (
          <Marker>
            <MarkerIcon>
              <WarningCircleIcon />
            </MarkerIcon>
            <MarkerContent>
              <span className="font-mono">{part.name}</span> failed
              {typeof detail === "string" && detail.length > 0 && (
                <span className="block text-muted-foreground">{detail}</span>
              )}
            </MarkerContent>
          </Marker>
        )
      }
      if (part.name === RENDER_WIDGET_TOOL) {
        const input = part.input as RenderWidgetInput | undefined
        const definition = input ? getWidget(widgets, input.widget) : undefined
        if (!input || !definition) return null
        const slotName = slotNameForToolCall(part.id)
        // Only the newest render of a widget owns a live container; superseded (or reset) calls
        // collapse to a summary line instead of an empty frame.
        if (!activeSlots.has(slotName)) {
          return (
            <Marker role={part.output == null ? "status" : undefined}>
              <MarkerIcon>{part.output == null ? <Spinner /> : <WrenchIcon />}</MarkerIcon>
              <MarkerContent className={part.output == null ? "shimmer" : ""}>
                {part.output == null ? "Rendering" : "Rendered"}{" "}
                <span className="font-mono">{input.widget}</span>
              </MarkerContent>
            </Marker>
          )
        }
        return (
          <div className="flex flex-col gap-1">
            <div className="px-1 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
              {definition.description}
            </div>
            <div className="rounded-xl border border-dashed p-1.5">
              {/* The light-DOM child holding the widget render projects in here. */}
              <slot name={slotName} />
            </div>
          </div>
        )
      }
      if (part.name === ASK_QUESTIONNAIRE_TOOL) {
        if (part.output != null) {
          const skipped = (part.output as { skipped?: boolean }).skipped === true
          return (
            <Marker>
              <MarkerIcon>
                <CheckIcon />
              </MarkerIcon>
              <MarkerContent>{skipped ? "Questionnaire skipped" : "Answers sent"}</MarkerContent>
            </Marker>
          )
        }
        if (part.state !== "input-complete") return null
        const items = sanitizeQuestionnaireItems(part.input)
        if (items.length === 0) {
          return (
            <Marker>
              <MarkerIcon>
                <WarningCircleIcon />
              </MarkerIcon>
              <MarkerContent>The questionnaire could not be displayed</MarkerContent>
            </Marker>
          )
        }
        return (
          <InlineQuestionnaire
            items={items}
            onAnswers={(answers) => onQuestionnaireAnswers(part.id, answers)}
          />
        )
      }
      const running = !isSettledToolCall(part)
      return (
        <Marker role={running ? "status" : undefined}>
          <MarkerIcon>{running ? <Spinner /> : <WrenchIcon />}</MarkerIcon>
          <MarkerContent className={running ? "shimmer" : ""}>
            {running ? "Running" : "Ran"} <span className="font-mono">{part.name}</span>
          </MarkerContent>
        </Marker>
      )
    }
    default:
      // tool-result parts mirror the output already shown on their tool-call part.
      return null
  }
}

export function ChatWidget(
  { options, host }: { options: MountAstralBeamChatOptions; host: HTMLElement },
) {
  const widgets = options.widgets ?? {}
  // Slot names whose light-DOM container currently holds a live widget render; the transcript
  // renders a real <slot> only for these and a summary marker for superseded calls.
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

  // The connection and tool set are fixed per mount; widget or tool changes afterwards are not
  // supported yet. Everything the closures need lives in refs, so first-render capture is safe.
  const [session] = useState(() => {
    const renderWidget = async ({ widget, props }: RenderWidgetInput, toolCallId: string) => {
      const definition = getWidget(widgets, widget)
      if (!definition) throw new Error(`Unknown widget "${widget}"`)
      const validated = await validateParameters(definition.parameters, props ?? {})
      if (validated == null) throw new Error(`Props for widget "${widget}" failed validation`)
      if (!mounted.current) throw new Error("The chat is no longer mounted")
      const slotName = slotNameForToolCall(toolCallId)
      const previous = activeRenders.current.get(widget)
      if (previous) disposeWidgetRender(previous)
      // The container is a light-DOM child of the shadow host, so the <slot> rendered in the
      // transcript projects it into the conversation.
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
      return { widget, rendered: true }
    }
    const tools = [
      ...(Object.keys(widgets).length > 0 ? [buildRenderWidgetTool(widgets, renderWidget)] : []),
      buildAskQuestionnaireTool(),
      ...buildHostTools(options.tools ?? {}),
    ]
    return {
      connection: fetchServerSentEvents(options.endpoint ?? DEFAULT_ENDPOINT),
      tools,
      toolNames: new Set(tools.map((tool) => tool.name)),
    }
  })
  const { messages, sendMessage, setMessages, status, error, addToolResult, stop, reload } =
    useChat({
      initialMessages: [],
      connection: session.connection,
      tools: session.tools,
      ...(options.systemPrompt ? { forwardedProps: { systemPrompt: options.systemPrompt } } : {}),
    })
  const [draft, setDraft] = useState("")
  const streamBusy = status === "submitted" || status === "streaming"
  // Host tools execute between runs with status "ready". A send in that window ships their tool
  // call unresolved, and the endpoint answers by re-offering the pending tool instead of calling
  // the model — the message goes unanswered and the redelivered call can re-execute a
  // side-effecting tool — so those windows count as busy too. Questionnaires and calls to tools
  // this mount never implemented stay interactive: sendDraft settles them instead.
  const pendingToolRun = messages.some((message) =>
    message.parts.some((part) =>
      part.type === "tool-call" && !isSettledToolCall(part) &&
      part.name !== ASK_QUESTIONNAIRE_TOOL && session.toolNames.has(part.name)
    )
  )
  const isBusy = streamBusy || pendingToolRun

  const sendDraft = () => {
    const text = draft.trim()
    if (isBusy || text.length === 0) return
    // A run input holding an unresolved tool call never reaches the model — the endpoint
    // re-offers the pending tool and finishes, leaving the message unanswered — so settle every
    // dangling call first: questionnaires as skipped, unimplemented tools as errors. The
    // resolution may auto-resume the run; the library then queues this message right behind it.
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-call" || isSettledToolCall(part)) continue
        if (part.name === ASK_QUESTIONNAIRE_TOOL) {
          void addToolResult({
            toolCallId: part.id,
            tool: part.name,
            output: { answers: [], skipped: true },
          })
        } else {
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
                    {
                      /* "submitted" covers fresh sends AND the follow-up request after every tool
                        result, where the last message is the assistant's — the model is working
                        either way, so the indicator must not depend on who spoke last. */
                    }
                    {status === "submitted" && (
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
                  onClick={() => stop()}
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
