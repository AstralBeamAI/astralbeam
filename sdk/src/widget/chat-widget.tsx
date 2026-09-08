import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Button } from "@/widget/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/widget/components/ui/card"
import { ChatComposer } from "./components/chat-composer.tsx"
import { ChatTranscript } from "./components/chat-transcript.tsx"
import { SandboxPanel } from "./components/sandbox-panel.tsx"
import { SandboxStatusPill } from "./components/sandbox-status.tsx"
import {
  acceptAttachmentFiles,
  attachmentContentParts,
  readAttachmentData,
  resolveAttachmentOptions,
} from "./lib/attachments.ts"
import { DEFAULT_API_URL, DEFAULT_TITLE } from "../lib/constants.ts"
import type { MountAstralBeamChatOptions, WidgetDefinition } from "../lib/types.ts"
import { createDebugLogger } from "../lib/debug.ts"
import { ASK_QUESTIONNAIRE_TOOL } from "../core/protocol.ts"
import { createDebugCallbacks } from "./lib/stream-debug.ts"
import {
  type AstralBeamChatCore,
  type AstralBeamChatCoreOptions,
  createAstralBeamChat,
} from "../core/session.ts"
import type { DraftAttachment, QuestionnaireAnswer } from "./lib/types.ts"
import { cn } from "cn"
import { hasPendingToolRun, lastPartInProgress } from "./lib/utils.ts"
import type { ChatController } from "./index.tsx"
import { hostSlotName, useHostSlots } from "./use-host-slots.ts"
import { useWidgetRenders } from "./use-widget-renders.ts"

// Shared fallback so `widgets` keeps its identity across renders when the host registers none;
// a fresh `{}` would rebuild the memoized session options (and push them through the session).
const NO_WIDGETS: Record<string, WidgetDefinition> = {}

export function ChatWidget(
  { options, host, controller }: {
    options: MountAstralBeamChatOptions
    host: HTMLElement
    controller: ChatController
  },
) {
  const widgets = options.widgets ?? NO_WIDGETS
  const debug = useMemo(() => createDebugLogger(options.debug), [options.debug])
  const { activeSlots, renderWidget } = useWidgetRenders(widgets, host, debug)
  const hostSlots = useHostSlots(options.slots, host, debug)
  const streamCallbacks = useMemo(() => createDebugCallbacks(debug), [debug])
  // Everything the headless session owns: authentication, transport, the tool protocol, and
  // transcript state. Memoized because the update effect below keys off it.
  const sessionOptions = useMemo<AstralBeamChatCoreOptions>(() => ({
    agentId: options.agentId,
    apiUrl: options.apiUrl,
    fetchAstralBeamToken: options.fetchAstralBeamToken,
    tools: options.tools,
    widgets,
    onRenderWidget: renderWidget,
    streamCallbacks,
    debug: options.debug,
  }), [
    options.agentId,
    options.apiUrl,
    options.fetchAstralBeamToken,
    options.tools,
    options.debug,
    widgets,
    renderWidget,
    streamCallbacks,
  ])
  const sessionOptionsRef = useRef(sessionOptions)
  sessionOptionsRef.current = sessionOptions
  // One session per committed mount, retuned in place: built on first render rather than in a
  // `useState` initializer, though Strict Mode's render probe can still build a discarded second.
  const chatRef = useRef<AstralBeamChatCore | null>(null)
  chatRef.current ??= createAstralBeamChat(sessionOptionsRef.current)
  const chat = chatRef.current
  // Re-applies the initial values harmlessly; afterwards, every option change retunes the session.
  useEffect(() => {
    chat.updateOptions(sessionOptions)
  }, [chat, sessionOptions])
  useEffect(() => () => chat.dispose(), [chat])
  const { messages, status, error, auth, capabilities, sandbox, sandboxStatus, agentTools } =
    useSyncExternalStore(chat.subscribe, chat.getState, chat.getState)

  const toolNames = useMemo(() => new Set(agentTools.map((tool) => tool.name)), [agentTools])
  const toolTitles = useMemo(() => {
    const titles: Record<string, string> = {}
    for (const tool of agentTools) if (tool.title !== undefined) titles[tool.name] = tool.title
    return titles
  }, [agentTools])
  useEffect(() => {
    debug?.("mount", "tool set declared to the agent", {
      tools: [...toolNames],
      widgets: Object.keys(widgets),
    })
  }, [debug, toolNames, widgets])
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL
  const sandboxHasWork = sandbox.files.length > 0 || sandbox.commands.length > 0
  useEffect(() => {
    debug?.("status", `chat status is "${status}"`)
  }, [debug, status])
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  // The agent's grant wins over the host option: the client may narrow, never widen.
  const attachmentLimits = useMemo(
    () => resolveAttachmentOptions(capabilities.attachments ? options.attachments : false),
    [options.attachments, capabilities.attachments],
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
  const authPending = auth.status === "loading"
  const authError = auth.status === "error" ? auth.error : undefined
  const isBusy = authPending || authError !== undefined || streamBusy ||
    hasPendingToolRun(messages, toolNames)

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
    debug?.(
      "send",
      text.length > 0 ? text : `${parts.length} attachment(s), no message text`,
      parts.length === 0 ? undefined : {
        attachments: attachments.filter((attachment) => attachment.status === "ready").map((
          attachment,
        ) => ({ name: attachment.name, kind: attachment.kind, size: attachment.size })),
      },
    )
    // The session settles dangling tool calls before the send, so the run can proceed.
    void chat.sendMessage(
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
    void chat.addToolResult({
      toolCallId,
      tool: ASK_QUESTIONNAIRE_TOOL,
      output: { answers },
    })
  }

  const resetConversation = () => {
    // The session's reset is the client's own: it aborts an active stream, drops queued sends,
    // resets resume state, and disposes the live widget renders.
    chat.reset()
    setDraft("")
    setAttachments([])
  }

  // Re-registered every render so the loader's handle always calls the latest closures.
  useEffect(() => {
    controller.reset = resetConversation
    controller.stop = chat.stop
    return () => {
      controller.reset = undefined
      controller.stop = undefined
    }
  })

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
          {hostSlots.has("header")
            // The host's own header content, projected in the host page's style.
            ? <slot name={hostSlotName("header")} />
            : (
              <>
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
              </>
            )}
        </CardHeader>
      )}
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        <ChatTranscript
          messages={messages}
          apiUrl={apiUrl}
          emptySlot={hostSlots.has("empty") ? hostSlotName("empty") : undefined}
          emptyTitle={options.emptyTitle}
          emptyDescription={options.emptyDescription}
          widgets={widgets}
          toolTitles={toolTitles}
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
        {sandboxStatus !== undefined && <SandboxStatusPill status={sandboxStatus} />}
        {options.sandboxPanel === true && sandboxHasWork && <SandboxPanel activity={sandbox} />}
        <ChatComposer
          title={options.title ?? DEFAULT_TITLE}
          actionsSlot={hostSlots.has("composerActions")
            ? hostSlotName("composerActions")
            : undefined}
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendDraft}
          onStop={() => {
            debug?.("status", "generation stopped by user")
            chat.stop()
          }}
          onRetry={messages.length > 0 ? () => void chat.reload() : undefined}
          showError={status === "error"}
          error={error}
          streamBusy={streamBusy}
          isBusy={isBusy}
          authPending={authPending}
          authError={authError}
          onAuthRetry={chat.retryAuthentication}
          attachments={attachments}
          attachmentLimits={attachmentLimits}
          onAddFiles={addAttachmentFiles}
          onRemoveAttachment={removeAttachment}
        />
      </CardFooter>
    </Card>
  )
}
