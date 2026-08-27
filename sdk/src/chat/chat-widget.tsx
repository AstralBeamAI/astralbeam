import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChatComposer } from "../components/chat-composer.tsx"
import { ChatTranscript } from "../components/chat-transcript.tsx"
import {
  acceptAttachmentFiles,
  attachmentContentParts,
  readAttachmentData,
  resolveAttachmentOptions,
} from "../lib/attachments.ts"
import { DEFAULT_ENDPOINT, DEFAULT_TITLE } from "../lib/client-constants.ts"
import type { MountAstralBeamChatOptions, WidgetDefinition } from "../lib/client-types.ts"
import { createDebugLogger } from "../lib/client-utils.ts"
import { ASK_QUESTIONNAIRE_TOOL } from "../lib/constants.ts"
import { createDebugCallbacks } from "../lib/debug.ts"
import type { DraftAttachment, QuestionnaireAnswer } from "../lib/types.ts"
import { cn, hasPendingToolRun, isSettledToolCall, lastPartInProgress } from "../lib/utils.ts"
import { buildAgentTools } from "./agent.ts"
import {
  type ChatAuthenticationOptions,
  type ChatAuthenticationState,
  disposeChatAuthentication,
  fetchAuthenticatedChat,
  getValidChatToken,
  initializeChatAuthentication,
} from "./auth.ts"
import { useWidgetRenders } from "./use-widget-renders.ts"

// Shared fallback so `widgets` keeps its identity across renders when the host registers none;
// a fresh `{}` would rebuild the memoized tool set (and push it through useChat) on every render.
const NO_WIDGETS: Record<string, WidgetDefinition> = {}

export function ChatWidget(
  { options, host }: { options: MountAstralBeamChatOptions; host: HTMLElement },
) {
  const widgets = options.widgets ?? NO_WIDGETS
  const debug = useMemo(() => createDebugLogger(options.debug), [options.debug])
  const { activeSlots, renderWidget, discardAllRenders } = useWidgetRenders(widgets, host, debug)
  const [authenticationState, setAuthenticationState] = useState<ChatAuthenticationState>(() =>
    options.authEndpoint ? { status: "loading" } : { status: "ready" }
  )
  const [authentication] = useState<ChatAuthenticationOptions | undefined>(() =>
    options.authEndpoint
      ? {
        authEndpoint: options.authEndpoint,
        session: {
          cached: undefined,
          refreshPromise: undefined,
          abortController: new AbortController(),
        },
        onStateChange: setAuthenticationState,
        fetchClient: globalThis.fetch.bind(globalThis),
        debug,
      }
      : undefined
  )
  if (authentication) authentication.debug = debug
  useEffect(() => {
    if (!authentication) return
    void initializeChatAuthentication(authentication).catch(() => undefined)
    return () => disposeChatAuthentication(authentication)
  }, [authentication])

  // Rebuilt whenever the declared surface changes: `render_widget` carries the widget catalog in
  // its description, and a host tool's schema and `execute` are captured per definition. useChat
  // pushes a new array through `client.updateOptions`, so the next run sees the current set.
  const tools = useMemo(
    () => buildAgentTools(widgets, options.tools ?? {}, renderWidget, debug),
    [widgets, options.tools, debug, renderWidget],
  )
  const toolNames = useMemo(() => new Set(tools.map((tool) => tool.name)), [tools])
  useEffect(() => {
    debug?.("mount", "tool set declared to the agent", {
      tools: [...toolNames],
      widgets: Object.keys(widgets),
    })
  }, [debug, toolNames, widgets])

  // Fixed for the mount, which is why `chatEndpoint` is not part of an update: useChat reads the
  // connection only when it constructs its client, so a new one would cost the transcript.
  const [connection] = useState(() =>
    fetchServerSentEvents(
      options.chatEndpoint ?? DEFAULT_ENDPOINT,
      authentication
        ? async () => ({
          headers: { authorization: `Bearer ${await getValidChatToken(authentication)}` },
          fetchClient: (input, init) => fetchAuthenticatedChat({ ...authentication, input, init }),
        })
        : undefined,
    )
  )
  const debugCallbacks = useMemo(() => createDebugCallbacks(debug), [debug])
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
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const attachmentLimits = useMemo(
    () => resolveAttachmentOptions(options.attachments),
    [options.attachments],
  )
  // Ids only have to be unique within this composer, and `crypto.randomUUID` is undefined on a
  // host page served over plain HTTP. https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  const nextAttachmentId = useRef(0)
  // An update that turns attachments off must drop the picked files too; hiding the button alone
  // would leave them sendable.
  useEffect(() => {
    if (!attachmentLimits.enabled) setAttachments([])
  }, [attachmentLimits.enabled])
  const streamBusy = status === "submitted" || status === "streaming"
  const awaitingReply = streamBusy && !lastPartInProgress(messages)
  const authPending = authenticationState.status === "loading"
  const authError = authenticationState.status === "error" ? authenticationState.error : undefined
  const isBusy = authPending || authError !== undefined || streamBusy ||
    hasPendingToolRun(messages, toolNames)

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

  // Every picked file becomes a chip, a rejected one included, so a file the limits turn away
  // says why instead of vanishing. Reads are per file: one unreadable file must not lose the rest.
  const addAttachmentFiles = (files: File[]) => {
    const picked = acceptAttachmentFiles({
      files,
      existing: attachments,
      limits: attachmentLimits,
      createId: () => `attachment-${nextAttachmentId.current++}`,
    })
    setAttachments((current) => [...current, ...picked.map(({ draft: pick }) => pick)])
    const settle = (id: string, update: Partial<DraftAttachment>) =>
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.id === id ? { ...attachment, ...update } : attachment
        )
      )
    for (const { draft: pick, file } of picked) {
      if (pick.status === "error") {
        debug?.("attachment", `rejected "${pick.name}"`, {
          reason: pick.error,
          size: pick.size,
          type: file.type,
        })
        continue
      }
      debug?.("attachment", `attached "${pick.name}"`, {
        kind: pick.kind,
        mimeType: pick.mimeType,
        size: pick.size,
      })
      void readAttachmentData(file).then(
        (data) => settle(pick.id, { status: "ready", data }),
        (error: unknown) => {
          debug?.("error", `attachment "${pick.name}" could not be read`, error)
          settle(pick.id, { status: "error", error: "The file could not be read" })
        },
      )
    }
  }

  const removeAttachment = (id: string) => {
    debug?.("attachment", "attachment removed", { id })
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const sendDraft = () => {
    const text = draft.trim()
    // Files are sent ahead of the text so the agent reads the question with them already in
    // context, and a file still being read blocks the send rather than being left behind.
    const parts = attachmentContentParts(attachments)
    const pendingRead = attachments.some((attachment) => attachment.status === "reading")
    if (isBusy || pendingRead || (text.length === 0 && parts.length === 0)) return
    settleDanglingToolCalls()
    debug?.(
      "send",
      text.length > 0 ? text : `${parts.length} attachment(s), no message text`,
      parts.length === 0 ? undefined : {
        attachments: attachments.filter((attachment) => attachment.status === "ready").map((
          attachment,
        ) => ({ name: attachment.name, kind: attachment.kind, size: attachment.size })),
      },
    )
    void sendMessage(
      parts.length === 0 ? text : {
        content: [
          ...parts,
          ...(text.length > 0 ? [{ type: "text" as const, content: text }] : []),
        ],
      },
    )
    setDraft("")
    setAttachments([])
  }

  const submitQuestionnaireAnswers = (toolCallId: string, answers: QuestionnaireAnswer[]) => {
    debug?.("questionnaire", "answers submitted", { toolCallId, answers })
    void addToolResult({
      toolCallId,
      tool: ASK_QUESTIONNAIRE_TOOL,
      output: { answers },
    })
  }

  const resetConversation = () => {
    debug?.("status", "conversation reset")
    setMessages([])
    setDraft("")
    setAttachments([])
    discardAllRenders()
  }

  // The Card frame with a bordered header, an unpadded content area, and a footer composer is
  // shadcn's canonical chat assembly (docs/changelog/2026-06-chat-components). The host sizes and
  // frames the widget, so the card's own radius and ring are stripped for a full-bleed fit.
  const showHeader = options.showHeader !== false
  return (
    // Painted with `bg-background` over the card's raised `bg-card`, so the widget reads as the
    // host page's own surface; with no header its top padding goes too, as the transcript pads.
    <Card
      className={cn(
        "h-full w-full gap-0 rounded-none bg-background text-foreground ring-0",
        !showHeader && "pt-0",
      )}
    >
      {showHeader && (
        <CardHeader className="gap-1 border-b">
          <CardTitle>{options.title ?? DEFAULT_TITLE}</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Reset conversation"
              disabled={streamBusy || messages.length === 0}
              onClick={resetConversation}
            >
              <ArrowCounterClockwiseIcon />
            </Button>
          </CardAction>
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        <ChatTranscript
          messages={messages}
          widgets={widgets}
          activeSlots={activeSlots}
          isBusy={isBusy}
          awaitingReply={awaitingReply}
          onQuestionnaireAnswers={submitQuestionnaireAnswers}
        />
      </CardContent>
      {
        /* No border, bg-muted band, or full top padding on the composer: the scroller already
          fades messages at the edge, so the footer needs no separation of its own. */
      }
      <CardFooter className="flex-col gap-2 rounded-none border-t-0 bg-transparent pt-1">
        <ChatComposer
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendDraft}
          onStop={() => {
            debug?.("status", "generation stopped by user")
            stop()
          }}
          onRetry={messages.length > 0 ? () => void reload() : undefined}
          showError={status === "error"}
          error={error}
          streamBusy={streamBusy}
          isBusy={isBusy}
          authPending={authPending}
          authError={authError}
          onAuthRetry={authentication
            ? () =>
              void getValidChatToken({ ...authentication, force: true }).catch(() => undefined)
            : undefined}
          attachments={attachments}
          attachmentLimits={attachmentLimits}
          onAddFiles={addAttachmentFiles}
          onRemoveAttachment={removeAttachment}
        />
      </CardFooter>
    </Card>
  )
}
