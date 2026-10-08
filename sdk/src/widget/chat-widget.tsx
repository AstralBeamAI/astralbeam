import { NotePencilIcon } from "@phosphor-icons/react"
import {
  type RefObject,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Button } from "@/widget/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/widget/components/ui/card"
import { ChatComposer } from "./components/chat-composer.tsx"
import { ChatTranscript } from "./components/chat-transcript.tsx"
import { ConversationTitle } from "./components/conversation-title.tsx"
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
import { storedThreadAttachments, storedThreadDraft } from "./lib/drafts.ts"
import type { MountAstralBeamChatOptions, WidgetDefinition } from "../lib/types.ts"
import { createDebugLogger } from "../lib/debug.ts"
import { ASK_QUESTIONNAIRE_TOOL } from "../core/protocol.ts"
import { createDebugCallbacks } from "./lib/stream-debug.ts"
import { type AstralBeamChatCoreOptions, createAstralBeamChat } from "../core/session.ts"
import { authenticationIdentity } from "../core/auth.ts"
import { newUuid } from "../core/threads.ts"
import type { DraftAttachment, QuestionnaireAnswer } from "./lib/types.ts"
import { hasPendingToolRun, lastPartInProgress } from "./lib/utils.ts"
import type { ChatController } from "./index.tsx"
import { hostSlotName, useHostSlots } from "./use-host-slots.ts"
import { useWidgetRenders } from "./use-widget-renders.ts"

// Shared fallback so `widgets` keeps its identity across renders when the host registers none;
// a fresh `{}` would rebuild the memoized session options (and push them through the session).
const NO_WIDGETS: Record<string, WidgetDefinition> = {}
const EMPTY_ATTACHMENTS: DraftAttachment[] = []
const EMPTY_DRAFT = {
  text: "",
  attachments: EMPTY_ATTACHMENTS,
  // A failed write settles the UI but keeps the successful baseline for the next edit.
  settledAttachments: EMPTY_ATTACHMENTS,
  savedAttachments: EMPTY_ATTACHMENTS,
  attachmentsLoaded: false,
  storageError: false,
}

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
  const pendingAttachmentWrites = useRef(new Set<string>())
  useEffect(() => {
    if (auth.status !== "ready" || chatState.threadLoading || composer.attachmentsLoaded) return
    let cancelled = false
    void storedThreadAttachments({ apiUrl, identity: draftIdentity, threadId: draftKey })
      .then(
        (attachments) => ({ attachments, storageError: false }),
        () => ({ attachments: EMPTY_ATTACHMENTS, storageError: true }),
      )
      .then(({ attachments, storageError }) => {
        if (cancelled) return
        setDrafts((current) => {
          if (current.apiUrl !== apiUrl || current.identity !== draftIdentity) return current
          const value = current.threads.get(draftKey) ?? {
            ...EMPTY_DRAFT,
            text: storedThreadDraft(apiUrl, draftIdentity, draftKey),
          }
          if (value.attachmentsLoaded) return current
          return {
            ...current,
            threads: new Map(current.threads).set(draftKey, {
              ...value,
              attachments,
              settledAttachments: attachments,
              savedAttachments: attachments,
              attachmentsLoaded: true,
              storageError,
            }),
          }
        })
      })
    return () => {
      cancelled = true
    }
  }, [
    apiUrl,
    draftIdentity,
    draftKey,
    auth.status,
    chatState.threadLoading,
    composer.attachmentsLoaded,
  ])
  useEffect(() => {
    for (const [key, value] of drafts.threads) {
      if (!value.attachmentsLoaded || value.attachments === value.settledAttachments) continue
      const scope = JSON.stringify([drafts.apiUrl, drafts.identity, key])
      if (pendingAttachmentWrites.current.has(scope)) continue
      pendingAttachmentWrites.current.add(scope)
      const finish = (storageError: boolean) => {
        pendingAttachmentWrites.current.delete(scope)
        setDrafts((current) => {
          if (current.apiUrl !== drafts.apiUrl || current.identity !== drafts.identity)
            return current
          const latest = current.threads.get(key)
          if (!latest) return current
          return {
            ...current,
            threads: new Map(current.threads).set(key, {
              ...latest,
              settledAttachments: value.attachments,
              savedAttachments: storageError ? latest.savedAttachments : value.attachments,
              storageError,
            }),
          }
        })
      }
      void storedThreadAttachments({
        apiUrl: drafts.apiUrl,
        identity: drafts.identity,
        threadId: key,
        update: (files) => {
          const stored = new Map(files.map((file) => [file.id, file]))
          for (const file of value.savedAttachments) {
            if (!value.attachments.some((current) => current.id === file.id)) stored.delete(file.id)
          }
          for (const file of value.attachments) {
            if (
              file.status === "ready" &&
              !value.savedAttachments.some(
                (saved) => saved.id === file.id && saved.status === "ready",
              )
            )
              stored.set(file.id, file)
          }
          return [...stored.values()]
        },
      }).then(
        () => finish(false),
        () => finish(true),
      )
    }
  }, [drafts])
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
  const setAttachments = (update: (attachments: DraftAttachment[]) => DraftAttachment[]) =>
    updateDraft((current) => ({
      ...current,
      attachments: update(current.attachments),
    }))
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
    composer.attachments !== composer.settledAttachments ||
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
      createId: newUuid,
    })
    setAttachments((current) => [...current, ...picked.map(({ draft: pick }) => pick)])
    const settle = (id: string, update: Partial<DraftAttachment>) =>
      setDrafts((current) => {
        if (current.apiUrl !== apiUrl || current.identity !== draftIdentity) return current
        for (const [key, value] of current.threads) {
          if (!value.attachments.some((file) => file.id === id)) continue
          return {
            ...current,
            threads: new Map(current.threads).set(key, {
              ...value,
              attachments: value.attachments.map((file) =>
                file.id === id ? { ...file, ...update } : file,
              ),
            }),
          }
        }
        return current
      })
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
    const sentAttachmentIds = new Set(
      attachments.filter((file) => file.status === "ready").map((file) => file.id),
    )
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
          void storedThreadAttachments({
            apiUrl,
            identity: draftIdentity,
            threadId: "",
            moveTo: id,
          }).catch((error: unknown) => debug?.("error", "Draft files could not be moved", error))
          setDrafts((cached) => {
            if (cached.apiUrl !== apiUrl || cached.identity !== draftIdentity) return cached
            const value = cached.threads.get("")
            if (!value) return cached
            const destination = cached.threads.get(id)
            const threads = new Map(cached.threads)
            threads.set(id, {
              ...value,
              text: value.text || destination?.text || "",
              attachments: [
                ...new Map(
                  [...(destination?.attachments ?? []), ...value.attachments].map((file) => [
                    file.id,
                    file,
                  ]),
                ).values(),
              ],
              settledAttachments: EMPTY_ATTACHMENTS,
              savedAttachments: [
                ...(destination?.savedAttachments ?? []),
                ...value.savedAttachments,
              ],
            })
            threads.delete("")
            return { ...cached, threads }
          })
        },
        onAccepted: () => {
          if (storedThreadDraft(apiUrl, draftIdentity, submissionDraftKey) === sentDraft)
            storedThreadDraft(apiUrl, draftIdentity, submissionDraftKey, "")
          void storedThreadAttachments({
            apiUrl,
            identity: draftIdentity,
            threadId: submissionDraftKey,
            update: (files) => files.filter((file) => !sentAttachmentIds.has(file.id)),
          }).catch((error: unknown) =>
            debug?.("error", "Accepted draft files could not be cleared", error),
          )
          setDrafts((cached) => {
            if (cached.apiUrl !== apiUrl || cached.identity !== draftIdentity) return cached
            const value = cached.threads.get(submissionDraftKey)
            if (!value) return cached
            return {
              ...cached,
              threads: new Map(cached.threads).set(submissionDraftKey, {
                ...value,
                text: value.text === sentDraft ? "" : value.text,
                attachments: value.attachments.filter((file) => !sentAttachmentIds.has(file.id)),
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
    void storedThreadAttachments({
      apiUrl,
      identity: draftIdentity,
      threadId: "",
      update: () => [],
    }).catch((error: unknown) => debug?.("error", "Draft files could not be cleared", error))
    setDrafts((current) => {
      const threads = new Map(current.threads)
      threads.set("", { ...EMPTY_DRAFT, attachmentsLoaded: true })
      return { ...current, threads }
    })
  }

  const focusComposer = () =>
    requestAnimationFrame(() => host.shadowRoot?.querySelector("textarea")?.focus())

  const forgetDraft = (id: string) => {
    storedThreadDraft(apiUrl, draftIdentity, id, "")
    void storedThreadAttachments({
      apiUrl,
      identity: draftIdentity,
      threadId: id,
      update: () => [],
    }).catch((error: unknown) =>
      debug?.("error", "Deleted conversation's draft files could not be cleared", error),
    )
    setDrafts((current) => {
      if (current.apiUrl !== apiUrl || current.identity !== draftIdentity) return current
      const threads = new Map(current.threads)
      threads.delete(id)
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
    // host page's own surface. The fixed-height header replaces the card's top padding.
    <Card className="h-full w-full gap-0 rounded-none bg-background pt-0 text-foreground ring-0">
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
          <ThreadHistory
            key={`${apiUrl}:${draftIdentity}`}
            chat={chat}
            state={chatState}
            onDelete={forgetDraft}
            onSelect={focusComposer}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New chat"
            title="New chat"
            disabled={!chatState.thread && messages.length === 0}
            onClick={() => {
              resetThread()
              focusComposer()
            }}
          >
            <NotePencilIcon />
          </Button>
          {hostSlots.has("headerActions") && <slot name={hostSlotName("headerActions")} />}
        </CardHeader>
      )}
      {options.showConversationTitle === true && chatState.thread?.title && (
        <ConversationTitle
          key={`${apiUrl}:${draftIdentity}:${chatState.thread.id}`}
          chat={chat}
          state={chatState}
          thread={chatState.thread}
          onDelete={forgetDraft}
        />
      )}
      <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
        <ChatTranscript
          readOnly={chatState.thread?.role === "viewer"}
          messages={messages}
          getAttachment={chat.getAttachment}
          currentTenantUserId={auth.status === "ready" ? auth.currentUser.user.id : undefined}
          hasOlder={chatState.messagesCursor !== undefined}
          loadingHistory={chatState.threadLoading}
          loadingOlder={chatState.olderMessagesLoading}
          onLoadOlder={chat.loadOlderMessages}
          apiUrl={apiUrl}
          emptySlot={hostSlots.has("empty") ? hostSlotName("empty") : undefined}
          emptyHeadline={options.emptyHeadline}
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
        {chatState.threadLoading ? (
          <span role="status" className="w-full text-xs text-muted-foreground">
            Loading conversation…
          </span>
        ) : chatState.thread?.role === "viewer" ? (
          <span className="w-full text-xs text-muted-foreground">
            You can read this conversation.
          </span>
        ) : chatState.thread?.writerActive && !streamBusy ? (
          <span role="status" className="w-full text-xs text-muted-foreground">
            A turn is unfinished. Reopen the conversation to see updates.
          </span>
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
