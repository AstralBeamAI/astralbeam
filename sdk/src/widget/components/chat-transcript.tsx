import { memo, useEffect, useRef } from "react"
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
import { DEFAULT_EMPTY_DESCRIPTION, DEFAULT_EMPTY_HEADLINE } from "../../lib/constants.ts"
import type { WidgetDefinition } from "../../lib/types.ts"
import type { SavedMessageMetadata } from "../../core/threads.ts"
import type { QuestionnaireAnswer } from "../lib/types.ts"
import { AssistantPart } from "./assistant-part.tsx"
import { PartErrorBoundary } from "./part-error-boundary.tsx"
import { UserMessageBody } from "./user-message-body.tsx"

interface ChatTranscriptProps {
  readOnly?: boolean | undefined
  messages: UIMessage[]
  getFile?: ((id: string) => Promise<Blob>) | undefined
  /** Name of the host's empty-state slot; when set, it replaces the default empty state. */
  emptySlot?: string | undefined
  /** Headline of the empty transcript; defaults to `DEFAULT_EMPTY_HEADLINE`. */
  emptyHeadline?: string | undefined
  /** Subtitle of the empty transcript; defaults to `DEFAULT_EMPTY_DESCRIPTION`. */
  emptyDescription?: string | undefined
  widgets: Record<string, WidgetDefinition>
  /** Transcript labels for tools that declared a title, keyed by tool name. */
  toolTitles: Record<string, string>
  serverToolTitles?: Readonly<Record<string, string>> | undefined
  streaming?: boolean | undefined
  activeSlots: ReadonlyMap<string, string>
  interactiveToolIds: ReadonlySet<string>
  getAttachment: (messageId: string, partId: string) => Promise<Blob>
  currentTenantUserId?: string | undefined
  hasOlder: boolean
  loadingHistory?: boolean | undefined
  loadingOlder: boolean
  onLoadOlder: () => Promise<void>
  isBusy: boolean
  /** The stream is busy but nothing visible has progressed yet; shows the "Thinking…" marker. */
  awaitingReply: boolean
  onQuestionnaireAnswers: (toolCallId: string, answers: QuestionnaireAnswer[]) => void
}

// The latest turn is always on screen, so it skips the deferred 10rem placeholder that makes new
// items blink for a frame. History keeps `content-visibility: auto`.
const LATEST_TURN = "[content-visibility:visible]"

// Memoized so a streamed chunk re-renders only the message it changed.
const TranscriptMessage = memo(function TranscriptMessage({
  message,
  streaming,
  readOnly,
  latestTurn,
  currentTenantUserId,
  getAttachment,
  getFile,
  widgets,
  toolTitles,
  serverToolTitles,
  activeSlots,
  interactiveToolIds,
  onQuestionnaireAnswers,
}: Pick<
  ChatTranscriptProps,
  | "currentTenantUserId"
  | "getAttachment"
  | "getFile"
  | "widgets"
  | "toolTitles"
  | "serverToolTitles"
  | "activeSlots"
  | "interactiveToolIds"
  | "onQuestionnaireAnswers"
> & { message: UIMessage; streaming: boolean; readOnly: boolean; latestTurn: boolean }) {
  const saved = message.metadata?.astralbeam as SavedMessageMetadata | undefined
  const active =
    streaming && !readOnly && message.role === "assistant" && saved?.state !== "interrupted"
  const anotherParticipant =
    message.role === "user" &&
    currentTenantUserId !== undefined &&
    saved?.authorTenantUserId != null &&
    saved.authorTenantUserId !== currentTenantUserId
  return (
    <MessageScrollerItem messageId={message.id} className={latestTurn ? LATEST_TURN : undefined}>
      <Message align={message.role === "user" && !anotherParticipant ? "end" : "start"}>
        <MessageContent className="gap-1">
          {anotherParticipant && <span className="text-xs text-muted-foreground">Participant</span>}
          {message.role === "user" ? (
            <UserMessageBody message={message} getAttachment={getAttachment} />
          ) : (
            message.parts.map((part, partIndex) => (
              <PartErrorBoundary key={part.type === "tool-call" ? part.id : partIndex}>
                <AssistantPart
                  readOnly={readOnly}
                  part={part}
                  messageId={message.id}
                  getAttachment={getAttachment}
                  getFile={getFile}
                  widgets={widgets}
                  toolTitles={toolTitles}
                  serverToolTitles={serverToolTitles}
                  streaming={
                    active && (part.type !== "thinking" || partIndex === message.parts.length - 1)
                  }
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
              <MarkerIcon>{active ? <Spinner /> : <WarningCircleIcon />}</MarkerIcon>
              <MarkerContent>
                {active
                  ? "Response in progress."
                  : "Saved partial response. Completion has not been recorded."}
              </MarkerContent>
            </Marker>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
})

export function ChatTranscript({
  readOnly = false,
  messages,
  getFile,
  emptySlot,
  emptyHeadline,
  emptyDescription,
  widgets,
  toolTitles,
  serverToolTitles,
  streaming = false,
  activeSlots,
  interactiveToolIds,
  getAttachment,
  currentTenantUserId,
  hasOlder,
  loadingHistory = false,
  loadingOlder,
  onLoadOlder,
  isBusy,
  awaitingReply,
  onQuestionnaireAnswers,
}: ChatTranscriptProps) {
  const loadingEarlier = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const automaticPage = useRef<UIMessage[] | undefined>(undefined)
  useEffect(() => {
    const element = viewport.current
    if (!element || !hasOlder || loadingOlder || loadingHistory) return
    const loadEarlier = (event?: Event) => {
      if (element.scrollTop > 100 || loadingEarlier.current) return
      if (!event && automaticPage.current === messages) return
      automaticPage.current = messages
      loadingEarlier.current = true
      void onLoadOlder().finally(() => {
        loadingEarlier.current = false
      })
    }
    // Check after scroll restoration. Retry a failed page only on another scroll or history update.
    const frame = requestAnimationFrame(() => loadEarlier())
    element.addEventListener("scroll", loadEarlier)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener("scroll", loadEarlier)
    }
  }, [hasOlder, loadingOlder, loadingHistory, messages, onLoadOlder])
  // A reply with nothing visible yet stays behind the Thinking marker, so its gap cannot shift it.
  const last = messages.at(-1)
  const turnStart = messages.findLastIndex((message) => message.role === "user")
  const emptyReply =
    awaitingReply &&
    last?.role === "assistant" &&
    last.parts.every(
      (part) => (part.type === "text" || part.type === "thinking") && part.content.length === 0,
    )
  if (loadingHistory && messages.length === 0) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner /> Loading conversation…
      </div>
    )
  }
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
          <EmptyTitle>{emptyHeadline ?? DEFAULT_EMPTY_HEADLINE}</EmptyTitle>
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
    <MessageScrollerProvider autoScroll={!readOnly}>
      <MessageScroller className="h-full">
        {loadingOlder && (
          <div
            className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
            role="status"
          >
            <span className="flex items-center gap-2 rounded-md bg-background px-3 py-1 text-sm text-muted-foreground shadow-sm">
              <Spinner />
              Loading earlier messages…
            </span>
          </div>
        )}
        <MessageScrollerViewport preserveScrollOnPrepend ref={viewport}>
          <MessageScrollerContent aria-busy={isBusy} className="gap-3 px-(--card-spacing) py-2">
            {(emptyReply ? messages.slice(0, -1) : messages).map((message, index) => (
              <TranscriptMessage
                key={message.id}
                message={message}
                latestTurn={index >= turnStart}
                streaming={streaming && message === messages.at(-1)}
                readOnly={readOnly}
                currentTenantUserId={currentTenantUserId}
                getAttachment={getAttachment}
                getFile={getFile}
                widgets={widgets}
                toolTitles={toolTitles}
                serverToolTitles={serverToolTitles}
                activeSlots={activeSlots}
                interactiveToolIds={interactiveToolIds}
                onQuestionnaireAnswers={onQuestionnaireAnswers}
              />
            ))}
            {awaitingReply && (
              <MessageScrollerItem messageId="astralbeam-thinking" className={LATEST_TURN}>
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
