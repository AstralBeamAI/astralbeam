import { ChatCircleDotsIcon } from "@phosphor-icons/react"
import type { UIMessage } from "@tanstack/ai-client"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/widget/components/ui/empty"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Message, MessageContent } from "@/widget/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/widget/components/ui/message-scroller"
import { Spinner } from "@/widget/components/ui/spinner"
import { DEFAULT_EMPTY_DESCRIPTION, DEFAULT_EMPTY_TITLE } from "../../lib/constants.ts"
import type { WidgetDefinition } from "../../lib/types.ts"
import type { QuestionnaireAnswer } from "../lib/types.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { PartErrorBoundary } from "./part-error-boundary.tsx"
import { UserMessageBody } from "./user-message-body.tsx"

interface ChatTranscriptProps {
  messages: UIMessage[]
  /** Name of the host's empty-state slot; when set, it replaces the default empty state. */
  emptySlot?: string | undefined
  /** Headline of the empty transcript; defaults to `DEFAULT_EMPTY_TITLE`. */
  emptyTitle?: string | undefined
  /** Subtitle of the empty transcript; defaults to `DEFAULT_EMPTY_DESCRIPTION`. */
  emptyDescription?: string | undefined
  widgets: Record<string, WidgetDefinition>
  /** Transcript labels for tools that declared a title, keyed by tool name. */
  toolTitles: Record<string, string>
  activeSlots: ReadonlySet<string>
  isBusy: boolean
  /** The stream is busy but nothing visible has progressed yet; shows the "Thinking…" marker. */
  awaitingReply: boolean
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

export function ChatTranscript(
  {
    messages,
    emptySlot,
    emptyTitle,
    emptyDescription,
    widgets,
    toolTitles,
    activeSlots,
    isBusy,
    awaitingReply,
    onQuestionnaireAnswers,
  }: ChatTranscriptProps,
) {
  if (messages.length === 0) {
    if (emptySlot) {
      // The host's own empty state; the wrapper gives the projected content the full height.
      return (
        <div className="h-full overflow-y-auto">
          <slot name={emptySlot} />
        </div>
      )
    }
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChatCircleDotsIcon />
          </EmptyMedia>
          <EmptyTitle>{emptyTitle ?? DEFAULT_EMPTY_TITLE}</EmptyTitle>
          <EmptyDescription>{emptyDescription ?? DEFAULT_EMPTY_DESCRIPTION}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    /* autoScroll with no scroll anchors keeps the newest content at the bottom. The
     * alternative, anchoring each user message to the top, grows a spacer sized to make
     * that scroll position reachable, which reads as dead space whenever the reply is
     * shorter than the viewport — common in a narrow sidebar. */
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="h-full">
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={isBusy} className="p-(--card-spacing)">
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
                            toolTitles={toolTitles}
                            activeSlots={activeSlots}
                            onQuestionnaireAnswers={onQuestionnaireAnswers}
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
                  <MarkerIcon>
                    <Spinner />
                  </MarkerIcon>
                  <MarkerContent className="shimmer">Thinking…</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
