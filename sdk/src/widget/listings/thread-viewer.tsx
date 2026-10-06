import { useCallback, useMemo, useState, type ComponentType } from "react"
import { parsePartialJSON } from "@tanstack/ai-client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { DirectoryThreadEncoded } from "../../api/generated/api.ts"
import { isAstralBeamApiError } from "../../api/api.ts"
import { DEFAULT_API_URL } from "../../lib/constants.ts"
import {
  loadDirectoryThreadHistory,
  loadDirectoryThreadAttachment,
  type ListingSession,
} from "../../core/listings.ts"
import { projectThreadMessages } from "../../core/threads.ts"
import { Button } from "../components/ui/button.tsx"
import { ChatTranscript } from "../components/chat-transcript.tsx"

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
  const getAttachment = useCallback(
    async (messageId: string, partId: string) => {
      try {
        return await loadDirectoryThreadAttachment(
          session,
          thread.tenant_id,
          thread.id,
          messageId,
          partId,
          session.abortController.signal,
        )
      } catch (error) {
        if (isAstralBeamApiError(error) && [401, 403, 404].includes(error.status))
          setAttachmentError(error)
        throw error
      }
    },
    [session, thread.tenant_id, thread.id],
  )
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
  return (
    <section
      data-slot="directory-transcript"
      aria-label="Saved conversation"
      className="flex min-h-96 flex-col gap-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ArrowLeftIcon aria-hidden />
          Back to conversations
        </Button>
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
            apiUrl={session.options.apiUrl ?? DEFAULT_API_URL}
            widgets={{}}
            toolTitles={{}}
            activeSlots={new Map()}
            interactiveToolIds={new Set()}
            readOnly
            getAttachment={getAttachment}
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
}
