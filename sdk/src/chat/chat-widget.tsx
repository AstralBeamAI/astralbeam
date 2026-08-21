import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  FileTextIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react"
import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react"
import { useEffect, useRef, useState } from "react"
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
  type QuestionnaireInput as QuestionnaireToolInput,
  type QuestionnaireItemSpec,
  RENDER_WIDGET_TOOL,
  type RenderWidgetInput,
  slotNameForWidget,
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
}

function disposeWidgetRender({ container, cleanup }: ActiveWidgetRender) {
  cleanup?.()
  container.remove()
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
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

function AssistantPart({ part, widgets, onQuestionnaireAnswers }: AssistantPartProps) {
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
        return (
          <Marker>
            <MarkerIcon>
              <WarningCircleIcon />
            </MarkerIcon>
            <MarkerContent>
              <span className="font-mono">{part.name}</span> failed
            </MarkerContent>
          </Marker>
        )
      }
      if (part.name === RENDER_WIDGET_TOOL) {
        const input = part.input as RenderWidgetInput | undefined
        const definition = input ? getWidget(widgets, input.widget) : undefined
        if (!input || !definition) return null
        return (
          <div className="flex flex-col gap-1">
            <div className="px-1 text-[0.625rem] tracking-wide text-muted-foreground uppercase">
              {definition.description}
            </div>
            <div className="rounded-xl border border-dashed p-1.5">
              {/* The light-DOM child holding the widget render projects in here. */}
              {part.output != null && <slot name={slotNameForWidget(input.widget)} />}
            </div>
          </div>
        )
      }
      if (part.name === ASK_QUESTIONNAIRE_TOOL) {
        const input = part.input as QuestionnaireToolInput | undefined
        if (!input?.items?.length || part.state === "input-streaming") return null
        if (part.output != null) {
          return (
            <Marker>
              <MarkerIcon>
                <CheckIcon />
              </MarkerIcon>
              <MarkerContent>Answers sent</MarkerContent>
            </Marker>
          )
        }
        return (
          <InlineQuestionnaire
            items={input.items}
            onAnswers={(answers) => onQuestionnaireAnswers(part.id, answers)}
          />
        )
      }
      return (
        <Marker>
          <MarkerIcon>{part.output == null ? <Spinner /> : <WrenchIcon />}</MarkerIcon>
          <MarkerContent className={part.output == null ? "shimmer" : ""}>
            {part.output == null ? "Running" : "Ran"} <span className="font-mono">{part.name}</span>
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
  // A slot holds at most one active render per widget; a repeated request replaces the previous.
  const activeRenders = useRef(new Map<string, ActiveWidgetRender>())
  const removeActiveRenders = () => {
    activeRenders.current.forEach(disposeWidgetRender)
    activeRenders.current.clear()
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
    const renderWidget = async ({ widget, props }: RenderWidgetInput) => {
      const definition = getWidget(widgets, widget)
      if (!definition) throw new Error(`Unknown widget "${widget}"`)
      const validated = await validateParameters(definition.parameters, props ?? {})
      if (validated == null) throw new Error(`Props for widget "${widget}" failed validation`)
      if (!mounted.current) throw new Error("The chat is no longer mounted")
      const slotName = slotNameForWidget(widget)
      const previous = activeRenders.current.get(slotName)
      if (previous) disposeWidgetRender(previous)
      // The container is a light-DOM child of the shadow host, so the <slot> rendered in the
      // transcript once the tool call completes projects it into the conversation.
      const container = document.createElement("div")
      container.slot = slotName
      host.append(container)
      const cleanup = definition.render(validated, container)
      activeRenders.current.set(slotName, { container, cleanup: cleanup ?? undefined })
      return { widget, rendered: true }
    }
    return {
      connection: fetchServerSentEvents(options.endpoint ?? DEFAULT_ENDPOINT),
      tools: [
        ...(Object.keys(widgets).length > 0 ? [buildRenderWidgetTool(widgets, renderWidget)] : []),
        buildAskQuestionnaireTool(),
        ...buildHostTools(options.tools ?? {}),
      ],
    }
  })
  const { messages, sendMessage, setMessages, status, error, addToolResult } = useChat({
    initialMessages: [],
    connection: session.connection,
    tools: session.tools,
    ...(options.systemPrompt ? { forwardedProps: { systemPrompt: options.systemPrompt } } : {}),
  })
  const [draft, setDraft] = useState("")
  const isBusy = status === "submitted" || status === "streaming"

  const sendDraft = () => {
    if (isBusy || draft.trim().length === 0) return
    void sendMessage(draft.trim())
    setDraft("")
  }
  const lastMessage = messages[messages.length - 1]

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
          disabled={isBusy || messages.length === 0}
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
                                <AssistantPart
                                  key={partIndex}
                                  part={part}
                                  widgets={widgets}
                                  onQuestionnaireAnswers={(toolCallId, answers) => {
                                    void addToolResult({
                                      toolCallId,
                                      tool: ASK_QUESTIONNAIRE_TOOL,
                                      output: { answers },
                                    })
                                  }}
                                />
                              ))}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ))}
                    {status === "submitted" && lastMessage?.role === "user" && (
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
          <div className="mb-2 rounded-lg border border-destructive/50 px-3 py-2 text-xs text-destructive">
            {error?.message ?? "Something went wrong. Try sending your message again."}
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
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
