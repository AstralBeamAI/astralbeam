import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import {
  type RefObject,
  type SetStateAction,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
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
import { ThreadHistory } from "./components/thread-history.tsx"
import { SandboxPanel } from "./components/sandbox-panel.tsx"
import { SandboxStatusPill } from "./components/sandbox-status.tsx"
import {
  acceptAttachmentFiles,
  attachmentContentParts,
  readAttachmentData,
  resolveAttachmentOptions,
} from "./lib/attachments.ts"
import { DEFAULT_API_URL, DEFAULT_TITLE } from "../lib/constants.ts"
import { storedThreadDraft } from "./lib/drafts.ts"
import type { MountAstralBeamChatOptions, WidgetDefinition } from "../lib/types.ts"
import { createDebugLogger } from "../lib/debug.ts"
import { ASK_QUESTIONNAIRE_TOOL } from "../core/protocol.ts"
import { createDebugCallbacks } from "./lib/stream-debug.ts"
import { type AstralBeamChatCoreOptions, createAstralBeamChat } from "../core/session.ts"
import { authenticationIdentity } from "../core/auth.ts"
import type { DraftAttachment, QuestionnaireAnswer } from "./lib/types.ts"
import { cn } from "cn"
import { hasPendingToolRun, lastPartInProgress } from "./lib/utils.ts"
import type { ChatController } from "./index.tsx"
import { hostSlotName, useHostSlots } from "./use-host-slots.ts"
import { useWidgetRenders } from "./use-widget-renders.ts"

// Shared fallback so `widgets` keeps its identity across renders when the host registers none;
// a fresh `{}` would rebuild the memoized session options (and push them through the session).
const NO_WIDGETS: Record<string, WidgetDefinition> = {}
const EMPTY_DRAFT = { text: "", attachments: [] as DraftAttachment[] }

export function ChatWidget({
  options,
  host,
  controller,
}: {
  options: MountAstralBeamChatOptions
  host: HTMLElement
  controller: RefObject<ChatController | null>
}) {
  const widgets = options.widgets ?? NO_WIDGETS
  const debug = useMemo(() => createDebugLogger(options.debug), [options.debug])
  const { activeSlots, renderWidget } = useWidgetRenders(widgets, host, debug)
  const hostSlots = useHostSlots(options.slots, host, debug)
  const streamCallbacks = useMemo(() => createDebugCallbacks(debug), [debug])
  // Everything the headless session owns: authentication, transport, the tool protocol, and
  // transcript state. Memoized because the update effect below keys off it.
  const sessionOptions = useMemo<AstralBeamChatCoreOptions>(
    () => ({
      agentId: options.agentId,
      threadId: options.threadId,
      apiUrl: options.apiUrl,
      fetchAstralBeamToken: options.fetchAstralBeamToken,
      tools: options.tools,
      widgets,
      onRenderWidget: renderWidget,
      streamCallbacks,
      debug: options.debug,
    }),
    [
      options.agentId,
      options.threadId,
      options.apiUrl,
      options.fetchAstralBeamToken,
      options.tools,
      options.debug,
      widgets,
      renderWidget,
      streamCallbacks,
    ],
  )
  // One session per committed mount, retuned in place, though Strict Mode's render probe can
  // still build a discarded second.
  const [chat] = useState(() => createAstralBeamChat(sessionOptions, true))
  // Re-applies the initial values harmlessly; afterwards, every option change retunes the session.
  useEffect(() => {
    chat.updateOptions(sessionOptions)
  }, [chat, sessionOptions])
  useEffect(() => {
    chat.start()
    return () => chat.dispose()
  }, [chat])
  const chatState = useSyncExternalStore(chat.subscribe, chat.getState, chat.getState)
  const { messages, status, error, auth, capabilities, sandbox, sandboxStatus, agentTools } =
    chatState

  const toolNames = useMemo(() => new Set(agentTools.map((tool) => tool.name)), [agentTools])
  const interactiveToolIds = useMemo(() => {
    const ids = new Set(chatState.activeToolCallIds)
    if (auth.status === "ready" && chatState.thread?.role !== "viewer") {
      for (const pending of chatState.pendingInteractions) {
        if (pending.targetTenantUserId !== auth.currentUser.user.id) continue
        if (
          messages.some((message) =>
            message.parts.some(
              (part) =>
                part.type === "tool-call" &&
                part.id === pending.toolCallId &&
                part.name === ASK_QUESTIONNAIRE_TOOL,
            ),
          )
        )
          ids.add(pending.toolCallId)
      }
    }
    return ids
  }, [
    chatState.activeToolCallIds,
    chatState.pendingInteractions,
    chatState.thread?.role,
    auth,
    messages,
  ])
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
  const [drafts, setDrafts] = useState({
    apiUrl,
    identity: "",
    threads: new Map<string, typeof EMPTY_DRAFT>(),
  })
  const draftIdentity =
    auth.status === "ready" ? authenticationIdentity(auth.currentUser) : drafts.identity
  if (drafts.apiUrl !== apiUrl || drafts.identity !== draftIdentity) {
    setDrafts({
      apiUrl,
      identity: draftIdentity,
      threads: new Map(),
    })
  }
  const draftKey = chatState.thread?.id ?? ""
  const composer = drafts.threads.get(draftKey) ?? {
    ...EMPTY_DRAFT,
    text: storedThreadDraft(apiUrl, draftIdentity, draftKey),
  }
  const draft = composer.text
  const updateDraft = (transform: (current: typeof EMPTY_DRAFT) => typeof EMPTY_DRAFT) =>
    setDrafts((current) => {
      if (current.apiUrl !== apiUrl || current.identity !== draftIdentity) return current
      return {
        ...current,
        threads: new Map(current.threads).set(
          draftKey,
          transform(current.threads.get(draftKey) ?? composer),
        ),
      }
    })
  const setDraft = (text: string) => {
    storedThreadDraft(apiUrl, draftIdentity, draftKey, text)
    updateDraft((current) => ({ ...current, text }))
  }
  const setAttachments = (value: SetStateAction<DraftAttachment[]>) =>
    updateDraft((current) => ({
      ...current,
      attachments: typeof value === "function" ? value(current.attachments) : value,
    }))
  // The agent's grant wins over the host option: the client may narrow, never widen.
  const attachmentLimits = useMemo(
    () => resolveAttachmentOptions(capabilities.attachments ? options.attachments : false),
    [options.attachments, capabilities.attachments],
  )
  // A conversation's capability must not discard files selected in another draft.
  const attachments = attachmentLimits.enabled ? composer.attachments : EMPTY_DRAFT.attachments
  // Ids only have to be unique within this composer, and `crypto.randomUUID` is undefined on a
  // host page served over plain HTTP. https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
  const nextAttachmentId = useRef(0)
  const streamBusy = status === "submitted" || status === "streaming"
  const awaitingReply = streamBusy && !lastPartInProgress(messages)
  const authPending = auth.status === "loading"
  const authError = auth.status === "error" ? auth.error : undefined
  const isBusy =
    authPending ||
    authError !== undefined ||
    streamBusy ||
    chatState.threadLoading ||
    chatState.threadLoadFailed ||
    chatState.thread?.role === "viewer" ||
    chatState.thread?.agentId === null ||
    hasPendingToolRun(
      messages.map((message) => ({
        ...message,
        parts: message.parts.filter(
          (part) => part.type !== "tool-call" || interactiveToolIds.has(part.id),
        ),
      })),
      toolNames,
    )

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
          attachment.id === id ? { ...attachment, ...update } : attachment,
        ),
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
      parts.length === 0
        ? undefined
        : {
            attachments: attachments
              .filter((attachment) => attachment.status === "ready")
              .map((attachment) => ({
                name: attachment.name,
                kind: attachment.kind,
                size: attachment.size,
              })),
          },
    )
    const sentDraft = draft
    const sentAttachments = attachments
    let submissionDraftKey = draftKey
    void chat.sendMessage(
      parts.length === 0
        ? text
        : {
            content: [
              ...parts,
              ...(text.length > 0 ? [{ type: "text" as const, content: text }] : []),
            ],
          },
      {
        onThreadReady: (id) => {
          if (submissionDraftKey !== "") return
          submissionDraftKey = id
          const text = storedThreadDraft(apiUrl, draftIdentity, "")
          if (text) storedThreadDraft(apiUrl, draftIdentity, id, text)
          storedThreadDraft(apiUrl, draftIdentity, "", "")
          setDrafts((cached) => {
            if (cached.apiUrl !== apiUrl || cached.identity !== draftIdentity) return cached
            const value = cached.threads.get("")
            if (!value || cached.threads.has(id)) return cached
            const threads = new Map(cached.threads)
            threads.set(id, value)
            threads.delete("")
            return { ...cached, threads }
          })
        },
        onAccepted: () => {
          if (storedThreadDraft(apiUrl, draftIdentity, submissionDraftKey) === sentDraft)
            storedThreadDraft(apiUrl, draftIdentity, submissionDraftKey, "")
          setDrafts((cached) => {
            if (cached.apiUrl !== apiUrl || cached.identity !== draftIdentity) return cached
            const value = cached.threads.get(submissionDraftKey)
            if (!value) return cached
            return {
              ...cached,
              threads: new Map(cached.threads).set(submissionDraftKey, {
                text: value.text === sentDraft ? "" : value.text,
                attachments: value.attachments === sentAttachments ? [] : value.attachments,
              }),
            }
          })
        },
      },
    )
  }

  const submitQuestionnaireAnswers = (toolCallId: string, answers: QuestionnaireAnswer[]) => {
    debug?.("questionnaire", "answers submitted", { toolCallId, answers })
    void chat.addToolResult({
      toolCallId,
      tool: ASK_QUESTIONNAIRE_TOOL,
      output: { answers },
    })
  }

  const resetThread = () => {
    // The session's reset is the client's own: it aborts an active stream, drops queued sends,
    // resets resume state, and disposes the live widget renders.
    chat.reset()
    storedThreadDraft(apiUrl, draftIdentity, "", "")
    setDrafts((current) => {
      const threads = new Map(current.threads)
      threads.delete("")
      return { ...current, threads }
    })
  }

  // Re-registered every render so the loader's handle always calls the latest closures.
  useImperativeHandle(controller, () => ({ reset: resetThread, stop: chat.stop }))

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
          {hostSlots.has("header") ? (
            // The host's own header content, projected in the host page's style.
            <slot name={hostSlotName("header")} />
          ) : (
            <>
              <CardTitle>{options.title ?? DEFAULT_TITLE}</CardTitle>
              <CardAction>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Reset conversation"
                  disabled={streamBusy || messages.length === 0}
                  onClick={resetThread}
                >
                  <ArrowCounterClockwiseIcon />
                </Button>
              </CardAction>
            </>
          )}
        </CardHeader>
      )}
      <ThreadHistory
        key={`${apiUrl}:${draftIdentity}`}
        chat={chat}
        state={chatState}
        showSharing={options.showSharing ?? false}
        onDelete={(id) => {
          storedThreadDraft(apiUrl, draftIdentity, id, "")
          setDrafts((current) => {
            if (current.apiUrl !== apiUrl || current.identity !== draftIdentity) return current
            const threads = new Map(current.threads)
            threads.delete(id)
            return { ...current, threads }
          })
        }}
        onSelect={() => {
          requestAnimationFrame(() => host.shadowRoot?.querySelector("textarea")?.focus())
        }}
      />
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        <ChatTranscript
          messages={messages}
          getAttachment={chat.getAttachment}
          currentTenantUserId={auth.status === "ready" ? auth.currentUser.user.id : undefined}
          hasOlder={chatState.messagesCursor !== undefined}
          loadingOlder={chatState.olderMessagesLoading}
          onLoadOlder={chat.loadOlderMessages}
          apiUrl={apiUrl}
          emptySlot={hostSlots.has("empty") ? hostSlotName("empty") : undefined}
          emptyTitle={options.emptyTitle}
          emptyDescription={options.emptyDescription}
          widgets={widgets}
          toolTitles={toolTitles}
          activeSlots={activeSlots}
          interactiveToolIds={interactiveToolIds}
          isBusy={isBusy}
          awaitingReply={awaitingReply}
          onQuestionnaireAnswers={submitQuestionnaireAnswers}
        />
      </CardContent>
      {/* No border, bg-muted band, or full top padding on the composer: the scroller already
          fades messages at the edge, so the footer needs no separation of its own. */}
      <CardFooter className="flex-col gap-2 rounded-none border-t-0 bg-transparent pt-1">
        {chatState.thread?.role !== "viewer" &&
          chatState.pendingInteractions
            .filter(
              (pending) =>
                !interactiveToolIds.has(pending.toolCallId) &&
                (chatState.thread?.role === "manager" ||
                  (auth.status === "ready" &&
                    pending.targetTenantUserId === auth.currentUser.user.id)),
            )
            .map((pending) => (
              <div
                key={pending.responseTargetId}
                className="flex w-full items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1">An earlier action has no confirmed result.</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void chat.abandonToolCall(pending.toolCallId)}
                >
                  Continue with unknown outcome
                </Button>
              </div>
            ))}
        {sandboxStatus !== undefined && <SandboxStatusPill status={sandboxStatus} />}
        {options.sandboxPanel === true && sandboxHasWork && <SandboxPanel activity={sandbox} />}
        <ChatComposer
          title={options.title ?? DEFAULT_TITLE}
          actionsSlot={
            hostSlots.has("composerActions") ? hostSlotName("composerActions") : undefined
          }
          draft={draft}
          onDraftChange={setDraft}
          onSend={sendDraft}
          onStop={() => {
            debug?.("status", "generation stopped by user")
            chat.stop()
          }}
          onRetry={
            chatState.unsentMessage !== undefined
              ? () => void chat.sendMessage(chatState.unsentMessage!)
              : messages.length > 0
                ? () => void chat.reload()
                : undefined
          }
          retryLabel={chatState.unsentMessage !== undefined ? "Retry" : "Refresh"}
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
