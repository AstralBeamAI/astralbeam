import type { UIMessage } from "@tanstack/ai-client"
import { WarningCircleIcon } from "@phosphor-icons/react"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/widget/components/ui/empty"
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
import { Button } from "@/widget/components/ui/button"
import { DEFAULT_EMPTY_DESCRIPTION, DEFAULT_EMPTY_TITLE } from "../../lib/constants.ts"
import type { WidgetDefinition } from "../../lib/types.ts"
import type { SavedMessageMetadata } from "../../core/threads.ts"
import type { QuestionnaireAnswer } from "../lib/types.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { PartErrorBoundary } from "./part-error-boundary.tsx"
import { UserMessageBody } from "./user-message-body.tsx"

interface ChatTranscriptProps {
  readOnly?: boolean | undefined
  messages: UIMessage[]
  apiUrl: string
  /** Name of the host's empty-state slot; when set, it replaces the default empty state. */
  emptySlot?: string | undefined
  /** Headline of the empty transcript; defaults to `DEFAULT_EMPTY_TITLE`. */
  emptyTitle?: string | undefined
  /** Subtitle of the empty transcript; defaults to `DEFAULT_EMPTY_DESCRIPTION`. */
  emptyDescription?: string | undefined
  widgets: Record<string, WidgetDefinition>
  /** Transcript labels for tools that declared a title, keyed by tool name. */
  toolTitles: Record<string, string>
  activeSlots: ReadonlyMap<string, string>
  interactiveToolIds: ReadonlySet<string>
  getAttachment: (messageId: string, partId: string) => Promise<Blob>
  currentTenantUserId?: string | undefined
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<void>
  isBusy: boolean
  /** The stream is busy but nothing visible has progressed yet; shows the "Thinking…" marker. */
  awaitingReply: boolean
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

export function ChatTranscript({
  readOnly = false,
  messages,
  apiUrl,
  emptySlot,
  emptyTitle,
  emptyDescription,
  widgets,
  toolTitles,
  activeSlots,
  interactiveToolIds,
  getAttachment,
  currentTenantUserId,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  isBusy,
  awaitingReply,
  onQuestionnaireAnswers,
}: ChatTranscriptProps) {
  if (messages.length === 0 && !hasOlder) {
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
        <MessageScrollerViewport preserveScrollOnPrepend>
          <MessageScrollerContent aria-busy={isBusy} className="p-(--card-spacing)">
            {hasOlder && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingOlder}
                  onClick={() => void onLoadOlder()}
                >
                  {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
                </Button>
              </div>
            )}
            {messages.map((message) => {
              const saved = message.metadata?.astralbeam as SavedMessageMetadata | undefined
              const anotherParticipant =
                message.role === "user" &&
                saved?.authorTenantUserId != null &&
                saved.authorTenantUserId !== currentTenantUserId
              return (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <Message align={message.role === "user" && !anotherParticipant ? "end" : "start"}>
                    <MessageContent>
                      {anotherParticipant && (
                        <span className="text-xs text-muted-foreground">Participant</span>
                      )}
                      {message.role === "user" ? (
                        <UserMessageBody message={message} getAttachment={getAttachment} />
                      ) : (
                        message.parts.map((part, partIndex) => (
                          <PartErrorBoundary key={partIndex}>
                            <AssistantPart
                              readOnly={readOnly}
                              part={part}
                              apiUrl={apiUrl}
                              widgets={widgets}
                              toolTitles={toolTitles}
                              activeSlots={activeSlots}
                              interactiveToolIds={interactiveToolIds}
                              interrupted={saved?.state === "interrupted"}
                              onQuestionnaireAnswers={onQuestionnaireAnswers}
                            />
                          </PartErrorBoundary>
                        ))
                      )}
                      {message.role === "assistant" && saved?.state === "interrupted" && (
                        <Marker>
                          <MarkerIcon>
                            <WarningCircleIcon />
                          </MarkerIcon>
                          <MarkerContent>
                            Response interrupted. The saved content may be incomplete.
                          </MarkerContent>
                        </Marker>
                      )}
                      {message.role === "assistant" && saved?.state === "draft" && (
                        <Marker role="status">
                          <MarkerIcon>{readOnly ? <WarningCircleIcon /> : <Spinner />}</MarkerIcon>
                          <MarkerContent>
                            {readOnly
                              ? "Saved partial response. Completion has not been recorded."
                              : "Response in progress."}
                          </MarkerContent>
                        </Marker>
                      )}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )
            })}
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
