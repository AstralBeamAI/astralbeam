import {
  ArrowCounterClockwiseIcon,
  ArrowUpIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  FileTextIcon,
  WrenchIcon,
} from "@phosphor-icons/react"
import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import { useChat } from "@tanstack/ai-react"
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
import type { MountAstralBeamChatOptions, StandardSchemaV1, WidgetDefinition } from "../client.ts"
import {
  ANSWERS_PREFIX,
  ASK_QUESTIONNAIRE_TOOL,
  buildConversation,
  getMessageText,
  type QuestionnaireInput as QuestionnaireToolInput,
  type QuestionnaireItemSpec,
  RENDER_WIDGET_TOOL,
  type RenderWidgetInput,
  slotNameForWidget,
} from "./conversation.ts"

/** Widget names come from the agent, so inherited keys like "constructor" must not resolve. */
function getWidget(widgets: Record<string, WidgetDefinition>, name: string) {
  return Object.hasOwn(widgets, name) ? widgets[name] : undefined
}

/**
 * Agent-supplied props are untrusted: a Standard Schema in `parameters` validates them before the
 * host's `render` runs (null means rejected); plain JSON Schemas have no validator and pass through.
 */
async function validateWidgetProps(
  { parameters }: WidgetDefinition,
  props: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (!parameters || !("~standard" in parameters)) return props
  const result = (await (parameters as StandardSchemaV1)["~standard"].validate(props)) as {
    value?: Record<string, unknown>
    issues?: unknown
  }
  return result.issues ? null : result.value ?? {}
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

/** Formats questionnaire answers as the user message the simulated agent responds to. */
function summarizeAnswers(items: QuestionnaireItemSpec[], formData: FormData): string {
  const lines = items.map((item) => {
    const values = formData.getAll(item.name).map(String).filter((value) => value.length > 0)
    const labels = values.map(
      (value) => item.choices.find((choice) => choice.value === value)?.label ?? value,
    )
    return `${item.title} ${labels.length > 0 ? labels.join(", ") : "(skipped)"}`
  })
  return `${ANSWERS_PREFIX} ${lines.join(" · ")}`
}

function InlineQuestionnaire(
  { items, onAnswers }: { items: QuestionnaireItemSpec[]; onAnswers: (summary: string) => void },
) {
  return (
    <Questionnaire
      className="rounded-xl border bg-card p-4"
      items={items}
      onSubmit={(event) => {
        event.preventDefault()
        onAnswers(summarizeAnswers(items, new FormData(event.currentTarget)))
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
  submittedQuestionnaires: ReadonlySet<string>
  onQuestionnaireAnswers: (toolCallId: string, summary: string) => void
}

function AssistantPart(
  { part, widgets, submittedQuestionnaires, onQuestionnaireAnswers }: AssistantPartProps,
) {
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
        if (!input || part.output == null) return null
        if (submittedQuestionnaires.has(part.id)) {
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
            onAnswers={(summary) => onQuestionnaireAnswers(part.id, summary)}
          />
        )
      }
      return (
        <Marker>
          <MarkerIcon>{part.output == null ? <Spinner /> : <WrenchIcon />}</MarkerIcon>
          <MarkerContent className={part.output == null ? "shimmer" : ""}>
            Running <span className="font-mono">{part.name}</span>…
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
  // The conversation is scripted per mount; widget changes after mount are not supported yet.
  const [{ chat, connection }] = useState(() => buildConversation(widgets))
  const { messages, append, sendMessage, setMessages, status } = useChat({
    initialMessages: [],
    connection,
  })
  const [draft, setDraft] = useState("")
  const [submittedQuestionnaires, setSubmittedQuestionnaires] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const isBusy = status === "submitted" || status === "streaming"
  const nextMessage = chat.next(messages)
  const nextMessageText = nextMessage ? getMessageText(nextMessage) : null

  // Render a widget the first time its tool call completes: the container is a light-DOM child of
  // the shadow host, so the <slot> in the transcript projects it into the conversation.
  const dispatchedToolCalls = useRef(new Set<string>())
  const activeRenders = useRef(new Map<string, ActiveWidgetRender>())
  const removeActiveRenders = () => {
    activeRenders.current.forEach(disposeWidgetRender)
    activeRenders.current.clear()
  }
  const mounted = useRef(true)
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type !== "tool-call" || part.name !== RENDER_WIDGET_TOOL ||
          part.output == null || dispatchedToolCalls.current.has(part.id)
        ) continue
        dispatchedToolCalls.current.add(part.id)
        const input = part.input as RenderWidgetInput
        const definition = getWidget(widgets, input.widget)
        if (!definition) continue
        // Validation may be async, so the mounted flag stops a render arriving after unmount.
        void validateWidgetProps(definition, input.props ?? {}).then((props) => {
          if (props == null || !mounted.current) return
          // A slot holds at most one active render; a repeated request replaces the previous one.
          const slotName = slotNameForWidget(input.widget)
          const previous = activeRenders.current.get(slotName)
          if (previous) disposeWidgetRender(previous)
          const container = document.createElement("div")
          container.slot = slotName
          host.append(container)
          const cleanup = definition.render(props, container)
          activeRenders.current.set(slotName, { container, cleanup: cleanup ?? undefined })
        })
      }
    }
  }, [messages])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      removeActiveRenders()
    }
  }, [])

  const sendCurrent = () => {
    if (isBusy) return
    if (nextMessage) {
      void append(nextMessage)
    } else if (draft.trim().length > 0) {
      void sendMessage(draft.trim())
      setDraft("")
    }
  }
  const lastMessage = messages[messages.length - 1]

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <div className="font-semibold">AstralBeam</div>
          <div className="text-xs text-muted-foreground">Simulated agent — scripted replies</div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset conversation"
          disabled={isBusy || messages.length === 0}
          onClick={() => {
            setMessages([])
            setDraft("")
            setSubmittedQuestionnaires(new Set())
            dispatchedToolCalls.current.clear()
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
                <EmptyTitle>Start the demo conversation</EmptyTitle>
                <EmptyDescription>
                  Press send to play the queued messages through a simulated agent.
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
                                  submittedQuestionnaires={submittedQuestionnaires}
                                  onQuestionnaireAnswers={(toolCallId, summary) => {
                                    setSubmittedQuestionnaires(
                                      (previous) => new Set(previous).add(toolCallId),
                                    )
                                    void sendMessage(summary)
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
          sendCurrent()
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            aria-label={nextMessage ? "Next queued message" : "Message"}
            className="max-h-24 min-h-9"
            placeholder="Message AstralBeam…"
            readOnly={nextMessage != null}
            value={nextMessageText ?? draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                sendCurrent()
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="ml-auto"
              disabled={isBusy || (nextMessage == null && draft.trim().length === 0)}
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
