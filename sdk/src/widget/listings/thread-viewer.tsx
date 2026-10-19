import { useCallback, useMemo, useState, type ComponentType } from "react"
import { parsePartialJSON } from "@tanstack/ai-client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { DirectoryThreadEncoded } from "../../api/generated/api.ts"
import { isAstralBeamApiError } from "../../api/api.ts"
import {
  loadDirectoryThreadHistory,
  loadDirectoryThreadFile,
  type ListingSession,
} from "../../core/listings.ts"
import { projectThreadMessages } from "../../core/threads.ts"
import type { AstralBeamChatCore } from "../../core/session.ts"
import { TooltipButton } from "../components/tooltip-button.tsx"
import { ChatTranscript } from "../components/chat-transcript.tsx"
import { AttachmentFileContext } from "../components/attachment-preview.tsx"

export function ThreadViewer({
  session,
  thread,
  onClose,
  ErrorFeedback,
  LoadingFeedback,
}: {
  session: ListingSession
  thread: DirectoryThreadEncoded
  onClose: () => void
  ErrorFeedback: ComponentType<{ error: Error; retry: () => void }>
  LoadingFeedback: ComponentType
}) {
  const [attachmentError, setAttachmentError] = useState<Error | null>(null)
  const query = useInfiniteQuery({
    queryKey: ["directory-history", thread.tenant_id, thread.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      loadDirectoryThreadHistory(session, thread.tenant_id, thread.id, pageParam, signal),
    getNextPageParam: (page) => page.page_after ?? undefined,
  })
  const getChatFile = useCallback<AstralBeamChatCore["getChatFile"]>(
    async (params, options) => {
      try {
        return await loadDirectoryThreadFile(
          session,
          { ...params, tenantId: thread.tenant_id },
          session.abortController.signal,
          options,
        )
      } catch (error) {
        if (isAstralBeamApiError(error) && [401, 403, 404].includes(error.status))
          setAttachmentError(error)
        throw error
      }
    },
    [session, thread.tenant_id],
  )
  const files = useMemo(() => ({ getChatFile, threadId: thread.id }), [getChatFile, thread.id])
  const messages = useMemo(() => {
    const projected = projectThreadMessages(
      query.data?.pages.toReversed().flatMap((page) => page.messages) ?? [],
    )
    for (const message of projected) {
      for (const part of message.parts) {
        if (part.type === "tool-call") {
          part.input = parsePartialJSON(part.arguments) as unknown
          part.state ??= "input-complete"
        }
      }
    }
    return projected
  }, [query.data])
  const error = attachmentError ?? query.error
  const inaccessible = isAstralBeamApiError(error) && [401, 403, 404].includes(error.status)
  const latest = query.data?.pages[0]?.thread ?? thread
  const content = (
    <section
      data-slot="directory-transcript"
      aria-label="Saved conversation"
      className="flex min-h-96 flex-col gap-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <TooltipButton
          variant="outline"
          size="icon-sm"
          tooltip="Back to conversations"
          onClick={onClose}
        >
          <ArrowLeftIcon aria-hidden className="rtl:rotate-180" />
        </TooltipButton>
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{latest.title || "Untitled conversation"}</h3>
          <p className="text-sm text-muted-foreground">Saved conversation · Read only</p>
        </div>
      </header>
      {error && (
        <ErrorFeedback
          error={error}
          retry={() => {
            void (
              attachmentError || !query.isFetchNextPageError
                ? query.refetch()
                : query.fetchNextPage()
            ).then((result) => {
              if (result.isSuccess) setAttachmentError(null)
            })
          }}
        />
      )}
      {query.isPending ? (
        <LoadingFeedback />
      ) : query.data && !inaccessible ? (
        <div className="h-[32rem] min-h-64 overflow-hidden rounded-lg border border-foreground/10 bg-background text-foreground [--card-spacing:--spacing(4)]">
          <ChatTranscript
            messages={messages}
            widgets={{}}
            toolTitles={{}}
            activeSlots={new Map()}
            interactiveToolIds={new Set()}
            readOnly
            hasOlder={query.hasNextPage && !query.isError}
            loadingHistory={query.isFetching}
            loadingOlder={query.isFetchingNextPage}
            onLoadOlder={async () => {
              await query.fetchNextPage({ cancelRefetch: false })
            }}
            isBusy={query.isFetching}
            awaitingReply={false}
            onQuestionnaireAnswers={() => {}}
          />
        </div>
      ) : null}
    </section>
  )
  return <AttachmentFileContext value={files}>{content}</AttachmentFileContext>
}
