import { ArrowClockwiseIcon, NotePencilIcon, XIcon } from "@phosphor-icons/react"
import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { Button } from "@/widget/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/widget/components/ui/card"
import { ChatComposer } from "./components/chat-composer.tsx"
import { ChatResizeHandle } from "./components/chat-resize-handle.tsx"
import { useChatWidth } from "./use-chat-width.ts"
import { ChatTranscript } from "./components/chat-transcript.tsx"
import { AttachmentFileContext } from "./components/attachment-preview.tsx"
import { ConversationTitle } from "./components/conversation-title.tsx"
import { McpConnectionsPanel } from "./components/mcp-connections.tsx"
import { ThreadHistory } from "./components/thread-history.tsx"
import { TooltipButton } from "./components/tooltip-button.tsx"
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
import { type AstralBeamChatCoreOptions, createAstralBeamChat } from "../core/session.ts"
import { authenticationIdentity } from "../core/auth.ts"
import { chatPlacementKey, newUuid } from "../core/threads.ts"
import type { DraftAttachment, QuestionnaireAnswer } from "./lib/types.ts"
import { describeUsageLimit, hasPendingToolRun, lastPartInProgress } from "./lib/utils.ts"
import type { ChatController } from "./index.tsx"
import { hostSlotName, useHostSlots } from "./use-host-slots.ts"
import { useComposerDraft } from "./use-composer-draft.ts"
import { useWidgetRenders } from "./use-widget-renders.ts"

// Shared fallback so `widgets` keeps its identity across renders when the host registers none;
// a fresh `{}` would rebuild the memoized session options (and push them through the session).
const NO_WIDGETS: Record<string, WidgetDefinition> = {}
const EMPTY_ATTACHMENTS: DraftAttachment[] = []

export function ChatWidget({
  options,
  host,
  controller,
}: {
  options: MountAstralBeamChatOptions
  host: HTMLElement
  controller: RefObject<ChatController | null>
}) {
  const panelId = useId()
  const sizing = useChatWidth(options, host)
  const closable = !!options.onClose
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
      placementKey: options.placementKey,
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
      options.placementKey,
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
  const files = useMemo(
    () => ({ getThreadAttachment: chat.getThreadAttachment, threadId: chatState.thread?.id }),
    [chat, chatState.thread?.id],
  )
  const { messages, status, auth, capabilities, sandbox, sandboxStatus, agentTools } = chatState
  const { history, submission } = chatState
  // A limit that ended a run mid-way is shown like a refused send, which retrying cannot fix.
  const usageLimit = chatState.usageLimitReached
  const error = usageLimit
    ? new Error(describeUsageLimit(usageLimit))
    : submission?.phase === "failed" || submission?.phase === "refused"
      ? submission.error
      : chatState.error

  const toolNames = useMemo(() => new Set(agentTools.map((tool) => tool.name)), [agentTools])
  // Joined into a key so the set keeps its identity across chunks and memoized messages skip them.
  const interactiveToolIdsKey = useMemo(() => {
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
    return [...ids].join("\n")
  }, [
    chatState.activeToolCallIds,
    chatState.pendingInteractions,
    chatState.thread?.role,
    auth,
    messages,
  ])
  const interactiveToolIds = useMemo(
    () => new Set(interactiveToolIdsKey ? interactiveToolIdsKey.split("\n") : []),
    [interactiveToolIdsKey],
  )
  const toolTitles = useMemo(() => {
    const titles: Record<string, string> = { ...chatState.serverToolTitles }
    for (const tool of agentTools) if (tool.title !== undefined) titles[tool.name] = tool.title
    return titles
  }, [agentTools, chatState.serverToolTitles])
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
  const composer = useComposerDraft({
    apiUrl,
    verifiedIdentity:
      auth.status === "ready"
        ? JSON.stringify([authenticationIdentity(auth.currentUser), chatPlacementKey(options)])
        : undefined,
    threadId: chatState.thread?.id ?? "",
    canLoad: auth.status === "ready" && (history === "idle" || history === "failed"),
    debug,
  })
  const draftIdentity = composer.identity
  // The agent's grant wins over the host option: the client may narrow, never widen.
  const attachmentLimits = useMemo(
    () =>
      resolveAttachmentOptions(
        capabilities.attachments && composer.attachmentsLoaded ? options.attachments : false,
      ),
    [options.attachments, capabilities.attachments, composer.attachmentsLoaded],
  )
  // A conversation's capability must not discard files selected in another draft.
  const attachments: DraftAttachment[] = []
  for (const file of attachmentLimits.enabled ? composer.attachments : EMPTY_ATTACHMENTS) {
    if (file.status === "error") {
      attachments.push(file)
      continue
    }
    const [picked] = acceptAttachmentFiles({
      files: [{ name: file.name, size: file.size, type: file.mimeType }],
      existing: attachments,
      limits: attachmentLimits,
      createId: () => file.id,
    })
    attachments.push(picked!.draft.status === "error" ? picked!.draft : file)
  }
  const streamBusy = status === "submitted" || status === "streaming"
  const awaitingReply = streamBusy && !lastPartInProgress(messages)
  const authPending = auth.status === "loading"
  const authError = auth.status === "error" ? auth.error : undefined
  const isBusy =
    authPending ||
    authError !== undefined ||
    streamBusy ||
    !composer.attachmentsLoaded ||
    composer.saving ||
    history === "loading" ||
    history === "failed" ||
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
      createId: newUuid,
    })
    composer.updateAttachments((current) => [...current, ...picked.map(({ draft: pick }) => pick)])
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
      const data = readAttachmentData(file)
      void chat
        .uploadAttachment({ data, filename: pick.name, mimeType: pick.mimeType })
        .then((uploaded) => {
          composer.settleAttachment(pick.id, {
            status: "ready",
            fileId: uploaded.fileId,
            mimeType: uploaded.mimeType,
            size: uploaded.byteSize,
          })
        })
        .catch((error: unknown) => {
          debug?.("error", `attachment "${pick.name}" could not be uploaded`, error)
          composer.settleAttachment(pick.id, {
            status: "error",
            error: "The file could not be uploaded",
          })
        })
    }
  }

  const removeAttachment = (id: string) => {
    debug?.("attachment", "attachment removed", { id })
    composer.updateAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  const sendDraft = () => {
    const text = composer.text.trim()
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
    const { restore, ...callbacks } = composer.submit(
      attachments.filter((file) => file.status === "ready"),
    )
    const sent = chat.sendMessage(
      parts.length === 0
        ? text
        : {
            content: [
              ...parts,
              ...(text.length > 0 ? [{ type: "text" as const, content: text }] : []),
            ],
          },
      callbacks,
    )
    void sent.then((outcome) => {
      if (outcome.phase === "refused") restore(outcome.content)
    })
  }

  const submitQuestionnaireAnswers = useCallback(
    (toolCallId: string, answers: QuestionnaireAnswer[]) => {
      debug?.("questionnaire", "answers submitted", { toolCallId, answers })
      void chat.addToolResult({ toolCallId, tool: ASK_QUESTIONNAIRE_TOOL, output: { answers } })
    },
    [chat, debug],
  )

  const resetThread = () => {
    // The session's reset is the client's own: it aborts an active stream, drops queued sends,
    // resets resume state, and disposes the live widget renders.
    chat.reset()
    composer.reset()
  }

  const focusComposer = () =>
    requestAnimationFrame(() => host.shadowRoot?.querySelector("textarea")?.focus())

  // Re-registered every render so the loader's handle always calls the latest closures.
  useImperativeHandle(controller, () => ({ reset: resetThread, stop: chat.stop }))

  // Closable chat fills the mobile viewport without changing its preferred desktop width.
  const showHeader = options.showHeader !== false
  const closeButton = options.onClose && (
    <TooltipButton
      variant="ghost"
      size="icon-sm"
      tooltip="Close chat"
      onClick={(event) => {
        // The second click on a host's opener can land on the newly rendered close control.
        // https://developer.mozilla.org/en-US/docs/Web/API/UIEvent/detail
        if (event.detail < 2) options.onClose?.()
      }}
    >
      <XIcon />
    </TooltipButton>
  )
  const content = (
    // Painted with `bg-background` over the card's raised `bg-card`, so the widget reads as the
    // host page's own surface. The fixed-height header replaces the card's top padding.
    <Card
      id={panelId}
      data-slot="chat"
      data-closable={closable}
      className="relative h-full w-full gap-0 overflow-clip rounded-none bg-background pt-0 text-foreground ring-0 [--card-spacing:--spacing(3)]"
    >
      <ChatResizeHandle sizing={sizing} panelId={panelId} />
      {showHeader && (
        <CardHeader className="flex h-14 shrink-0 items-center gap-1 border-b py-0 [.border-b]:pb-0">
          <div className="min-w-0 flex-1">
            {hostSlots.has("header") ? (
              // The host's own title content, projected in the host page's style.
              <slot name={hostSlotName("header")} />
            ) : (
              <CardTitle className="truncate">{options.title ?? DEFAULT_TITLE}</CardTitle>
            )}
          </div>
          <McpConnectionsPanel
            key={`mcp:${apiUrl}:${draftIdentity}`}
            chat={chat}
            state={chatState}
          />
          <ThreadHistory
            key={`${apiUrl}:${draftIdentity}`}
            chat={chat}
            state={chatState}
            onDelete={composer.forget}
            onSelect={focusComposer}
          />
          <TooltipButton
            variant="ghost"
            size="icon-sm"
            tooltip="New chat"
            disabled={!chatState.thread && messages.length === 0}
            onClick={(event) => {
              if (event.detail > 1) return
              resetThread()
              focusComposer()
            }}
          >
            <NotePencilIcon />
          </TooltipButton>
          {hostSlots.has("headerActions") && <slot name={hostSlotName("headerActions")} />}
          {closeButton}
        </CardHeader>
      )}
      {!showHeader && (
        <div className="flex justify-end px-2">
          <McpConnectionsPanel
            key={`mcp:${apiUrl}:${draftIdentity}`}
            chat={chat}
            state={chatState}
          />
          {closeButton}
        </div>
      )}
      {!!chatState.unavailableMcpConnections?.length && (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          Some connected tools are unavailable. Open MCP connections to review them.
        </p>
      )}
      {options.showConversationTitle === true && chatState.thread?.title && (
        <ConversationTitle
          key={`${apiUrl}:${draftIdentity}:${chatState.thread.id}`}
          chat={chat}
          state={chatState}
          thread={chatState.thread}
          onDelete={(threadId) => {
            composer.forget(threadId)
            focusComposer()
          }}
        />
      )}
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        <ChatTranscript
          readOnly={chatState.thread?.role === "viewer"}
          messages={messages}
          currentTenantUserId={auth.status === "ready" ? auth.currentUser.user.id : undefined}
          hasOlder={chatState.messagesCursor !== undefined}
          loadingHistory={history === "loading"}
          loadingOlder={chatState.olderMessagesLoading}
          onLoadOlder={chat.loadOlderMessages}
          emptySlot={hostSlots.has("empty") ? hostSlotName("empty") : undefined}
          emptyHeadline={options.emptyHeadline}
          emptyDescription={options.emptyDescription}
          widgets={widgets}
          toolTitles={toolTitles}
          serverToolTitles={chatState.serverToolTitles}
          streaming={status === "streaming"}
          activeSlots={activeSlots}
          interactiveToolIds={interactiveToolIds}
          isBusy={isBusy}
          awaitingReply={awaitingReply}
          onQuestionnaireAnswers={submitQuestionnaireAnswers}
        />
      </CardContent>
      {/* No border, bg-muted band, or full top padding on the composer: the scroller already
          fades messages at the edge, so the footer needs no separation of its own. */}
      <CardFooter className="flex-col gap-1 rounded-none border-t-0 bg-transparent pt-1 pb-2">
        {history === "loading" ? (
          <span role="status" className="w-full text-xs text-muted-foreground">
            Loading conversation…
          </span>
        ) : chatState.thread?.role === "viewer" ? (
          <span className="w-full text-xs text-muted-foreground">
            You can read this conversation.
          </span>
        ) : chatState.thread?.writerActive && !streamBusy ? (
          <div className="flex w-full items-center gap-2 text-sm text-muted-foreground">
            <span role="status" className="min-w-0 flex-1">
              This response is unfinished. Refresh to check for updates.
            </span>
            <TooltipButton
              variant="outline"
              size="icon-sm"
              tooltip="Refresh"
              onClick={() => void chat.refreshThread()}
            >
              <ArrowClockwiseIcon />
            </TooltipButton>
          </div>
        ) : null}
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
                className="flex w-full flex-wrap items-center gap-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  An earlier action may already have happened. Continuing skips its result without
                  running it again.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
                  onClick={() => void chat.abandonToolCall(pending.toolCallId)}
                >
                  Continue without result
                </Button>
              </div>
            ))}
        {sandboxStatus !== undefined && <SandboxStatusPill status={sandboxStatus} />}
        {options.sandboxPanel === true && sandboxHasWork && <SandboxPanel activity={sandbox} />}
        {attachmentLimits.enabled && composer.storageError && (
          <p role="status" className="w-full text-muted-foreground text-xs">
            Files cannot be recovered after reload because browser storage is unavailable.
          </p>
        )}
        <ChatComposer
          title={options.title ?? DEFAULT_TITLE}
          actionsSlot={
            hostSlots.has("composerActions") ? hostSlotName("composerActions") : undefined
          }
          draft={composer.text}
          onDraftChange={composer.setText}
          onSend={sendDraft}
          onStop={() => {
            debug?.("status", "generation stopped by user")
            chat.stop()
          }}
          onRetry={
            usageLimit || submission?.phase === "refused"
              ? undefined
              : submission?.phase === "failed"
                ? () => void chat.retry()
                : messages.length > 0
                  ? () => void chat.reload()
                  : undefined
          }
          retryLabel={submission?.phase === "failed" ? "Retry" : "Refresh"}
          showError={error !== undefined}
          error={error}
          streamBusy={streamBusy}
          isBusy={isBusy || submission?.phase === "failed"}
          authPending={authPending}
          threadLoading={history === "loading"}
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
  return <AttachmentFileContext.Provider value={files}>{content}</AttachmentFileContext.Provider>
}
