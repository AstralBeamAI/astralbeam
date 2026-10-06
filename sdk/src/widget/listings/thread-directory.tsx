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
  showTenant,
}: {
  session: ListingSession
  tenantId: string | undefined
  q: string
  size: number
  showTenant: boolean
}) {
  const [cursor, setCursor] = useState<{ page_after?: string; page_before?: string }>({})
  const [selected, setSelected] = useState<DirectoryThreadEncoded | null>(null)
  const query = useQuery({
    queryKey: ["threads", tenantId, q, size, cursor],
    queryFn: ({ signal }) => loadThreadDirectory(session, { tenantId, q, size, cursor }, signal),
  })
  const columns = useMemo<DirectoryColumns<DirectoryThreadEncoded>>(
    () => [
      ...(showTenant
        ? [
            {
              id: "tenant",
              header: "Tenant",
              cell: ({ row }: { row: { original: DirectoryThreadEncoded } }) => (
                <div className="min-w-40 max-w-64">
                  <div
                    className="truncate"
                    title={row.original.tenant_name ?? row.original.tenant_external_id}
                  >
                    {row.original.tenant_name || row.original.tenant_external_id}
                  </div>
                  <div
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={row.original.tenant_external_id}
                  >
                    {row.original.tenant_external_id}
                  </div>
                </div>
              ),
            },
          ]
        : []),
      {
        id: "title",
        header: "Conversation",
        cell: ({ row }) => (
          <Button
            variant="link"
            className="h-auto min-w-48 max-w-96 justify-start p-0 text-start whitespace-normal break-words"
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
            className="whitespace-nowrap text-muted-foreground"
            dateTime={row.original.updated_at}
            title={row.original.updated_at}
          >
            {new Date(row.original.updated_at).toLocaleString()}
          </time>
        ),
      },
    ],
    [showTenant],
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
