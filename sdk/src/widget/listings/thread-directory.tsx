import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { DirectoryThreadEncoded } from "../../api/generated/api.ts"
import { loadThreadDirectory, type ListingSession } from "../../core/listings.ts"
import { Button } from "../components/ui/button.tsx"
import { ListingError, ListingLoading, PageNavigation } from "./listing-widget.tsx"
import { ThreadViewer } from "./thread-viewer.tsx"
import { ListingTable, type DirectoryColumns } from "./table.tsx"

export function ThreadDirectoryPage({
  session,
  tenantId,
  q,
  size,
}: {
  session: ListingSession
  tenantId: string | undefined
  q: string
  size: number
}) {
  const [cursor, setCursor] = useState<{ page_after?: string; page_before?: string }>({})
  const [selected, setSelected] = useState<DirectoryThreadEncoded | null>(null)
  const query = useQuery({
    queryKey: ["threads", tenantId, q, size, cursor],
    queryFn: ({ signal }) => loadThreadDirectory(session, { tenantId, q, size, cursor }, signal),
  })
  const columns = useMemo<DirectoryColumns<DirectoryThreadEncoded>>(
    () => [
      {
        id: "participants",
        header: "Participants",
        cell: ({ row }) => (
          <div className="min-w-0 max-w-64 space-y-2 @4xl/directory:min-w-40">
            {row.original.participants.length === 0
              ? "No participants"
              : row.original.participants.map((participant) => (
                  <div key={participant.external_id}>
                    <div
                      className="line-clamp-3 whitespace-normal [overflow-wrap:anywhere]"
                      title={participant.name || participant.external_id}
                    >
                      {participant.name || participant.external_id}
                    </div>
                    {participant.name && (
                      <div
                        className="line-clamp-3 break-all font-mono text-xs text-muted-foreground"
                        title={participant.external_id}
                      >
                        {participant.external_id}
                      </div>
                    )}
                  </div>
                ))}
          </div>
        ),
      },
      {
        id: "title",
        header: "Conversation",
        cell: ({ row }) => (
          <Button
            variant="link"
            className="h-auto min-w-0 max-w-full @4xl/directory:min-w-48 @4xl/directory:max-w-96 justify-start p-0 text-start whitespace-normal break-words"
            onClick={() => setSelected(row.original)}
          >
            {row.original.title || "Untitled conversation"}
          </Button>
        ),
      },
      {
        id: "activity",
        header: "Last activity",
        cell: ({ row }) => (
          <time
            className="text-muted-foreground"
            dateTime={row.original.updated_at}
            title={row.original.updated_at}
          >
            {new Date(row.original.updated_at).toLocaleString()}
          </time>
        ),
      },
    ],
    [],
  )
  if (selected)
    return <ThreadViewer session={session} thread={selected} onClose={() => setSelected(null)} />
  return (
    <div data-slot="directory-page" aria-busy={query.isFetching} className="min-w-0 space-y-4">
      {query.isError ? (
        <ListingError error={query.error} retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ListingLoading />
      ) : (
        <div
          data-slot="directory-table"
          className="overflow-hidden rounded-lg border border-foreground/10 bg-card text-card-foreground"
        >
          <ListingTable
            rows={query.data.items}
            columns={columns}
            getRowId={(row) => `${row.tenant_id}:${row.id}`}
            emptyText={q ? "No conversations match your filters." : "No conversations yet."}
          />
        </div>
      )}
      <div data-slot="directory-pagination">
        <PageNavigation
          page={query.isError ? undefined : query.data}
          busy={query.isFetching}
          onPage={setCursor}
        />
      </div>
    </div>
  )
}
