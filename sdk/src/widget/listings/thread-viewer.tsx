import { useCallback } from "react"
import { parsePartialJSON } from "@tanstack/ai-client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { DirectoryThreadEncoded } from "../../api/generated/api.ts"
import { DEFAULT_API_URL } from "../../lib/constants.ts"
import {
  loadDirectoryThreadHistory,
  loadDirectoryThreadAttachment,
  type ListingSession,
} from "../../core/listings.ts"
import { projectThreadMessages } from "../../core/threads.ts"
import { Button } from "../components/ui/button.tsx"
import { ChatTranscript } from "../components/chat-transcript.tsx"
import { ListingError, ListingLoading } from "./listing-widget.tsx"

export function ThreadViewer({
  session,
  thread,
  onClose,
}: {
  session: ListingSession
  thread: DirectoryThreadEncoded
  onClose: () => void
}) {
  const query = useInfiniteQuery({
    queryKey: ["directory-history", thread.tenant_id, thread.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      loadDirectoryThreadHistory(session, thread.tenant_id, thread.id, pageParam, signal),
    getNextPageParam: (page) => page.page_after ?? undefined,
  })
  const getAttachment = useCallback(
    (messageId: string, partId: string) =>
      loadDirectoryThreadAttachment(
        session,
        thread.tenant_id,
        thread.id,
        messageId,
        partId,
        session.abortController.signal,
      ),
    [session, thread.tenant_id, thread.id],
  )
  const messages = projectThreadMessages(
    query.data?.pages.toReversed().flatMap((page) => page.messages) ?? [],
  )
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-call") {
        part.input = parsePartialJSON(part.arguments) as unknown
        part.state ??= "input-complete"
      }
    }
  }
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
      {query.isError ? (
        <ListingError error={query.error} retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ListingLoading />
      ) : (
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
            hasOlder={query.hasNextPage}
            loadingOlder={query.isFetchingNextPage}
            onLoadOlder={async () => {
              await query.fetchNextPage({ cancelRefetch: false })
            }}
            isBusy={query.isFetching}
            awaitingReply={false}
            onQuestionnaireAnswers={() => {}}
          />
        </div>
      )}
    </section>
  )
}
