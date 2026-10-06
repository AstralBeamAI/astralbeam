import { useId, useMemo } from "react"
import { type ColumnDef, tableFeatures, useTable } from "@tanstack/react-table"
import { CaretRightIcon } from "@phosphor-icons/react"
import type { TenantRecordEncoded, TenantUserRecordEncoded } from "../../api/generated/api.ts"
import type {
  MountAstralBeamTenantListOptions,
  MountAstralBeamTenantUserListOptions,
} from "../../client/listings.ts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.tsx"
import { Button } from "../components/ui/button.tsx"
import { Badge } from "../components/ui/badge.tsx"

const features = tableFeatures({})
export type DirectoryColumns<T extends { id: string }> = ColumnDef<typeof features, T>[]
type RecordRow = TenantRecordEncoded | TenantUserRecordEncoded
type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions

export function DirectoryTable({
  rows,
  kind,
  options,
  filtered,
}: {
  rows: RecordRow[]
  kind: "tenants" | "users"
  options: Options
  filtered: boolean
}) {
  const { onTenantSelect, onTenantUserSelect, showAdmin } = options
  const columns = useMemo<ColumnDef<typeof features, RecordRow>[]>(
    () => [
      {
        accessorKey: "external_id",
        header: "ID",
        cell: ({ row }) => (
          <span className="line-clamp-3 break-all font-mono text-xs whitespace-normal">
            {row.original.external_id}
          </span>
        ),
      },
      {
        id: "name",
        header: kind === "tenants" ? "Tenant" : "User",
        cell: ({ row }) => {
          const record = row.original
          const name = record.name || record.external_id
          return (
            <div className="flex min-w-0 items-center gap-3 py-1">
              {kind === "users" && (
                <span
                  data-slot="directory-avatar"
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase"
                >
                  {name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => Array.from(part)[0])
                    .join("")}
                </span>
              )}
              <span className="line-clamp-3 min-w-0 text-start whitespace-normal [overflow-wrap:anywhere]">
                {name}
              </span>
            </div>
          )
        },
      },
      ...(kind === "users" && showAdmin
        ? [
            {
              id: "admin",
              header: "Stored admin",
              cell: ({ row }: { row: { original: RecordRow } }) => (
                <Badge
                  variant="outline"
                  title="Stored status does not grant or revoke signed JWT authority"
                >
                  {"admin" in row.original && row.original.admin ? "Admin" : "User"}
                </Badge>
              ),
            },
          ]
        : []),
      {
        accessorKey: "metadata",
        header: "Metadata",
        cell: ({ row }) => {
          const entries = Object.entries(row.original.metadata)
          return entries.length ? (
            <dl className="space-y-1 text-xs whitespace-normal">
              {entries.map(([key, value]) => (
                <div key={key} className="flex gap-1">
                  <dt className="line-clamp-3 max-w-1/2 shrink-0 break-all text-muted-foreground">
                    {key}:
                  </dt>
                  <dd className="line-clamp-6 min-w-0 [overflow-wrap:anywhere]">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="text-muted-foreground">No metadata</span>
          )
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => (
          <time
            dateTime={row.original.created_at}
            title={row.original.created_at}
            className="whitespace-nowrap text-muted-foreground"
          >
            {new Date(row.original.created_at).toLocaleDateString()}
          </time>
        ),
      },
      ...((kind === "users" ? onTenantUserSelect : onTenantSelect)
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: RecordRow } }) => {
                const record = row.original
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      "tenant_id" in record
                        ? onTenantUserSelect?.(record)
                        : onTenantSelect?.(record)
                    }
                    aria-label={`Open ${record.name || record.external_id}`}
                    title="Open"
                  >
                    <CaretRightIcon aria-hidden />
                  </Button>
                )
              },
            },
          ]
        : []),
    ],
    [kind, onTenantSelect, onTenantUserSelect, showAdmin],
  )
  return (
    <ListingTable
      rows={rows}
      columns={columns}
      emptyText={filtered ? "No records match your filters." : "No records yet."}
    />
  )
}

export function ListingTable<T extends { id: string }>({
  rows,
  columns,
  emptyText,
  getRowId = (row: T) => row.id,
}: {
  rows: T[]
  columns: DirectoryColumns<T>
  emptyText: string
  getRowId?: (row: T) => string
}) {
  const tableId = useId()
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId,
  })
  return (
    <Table
      role="table"
      className="block table-fixed @4xl/directory:table [&_th]:h-12 [&_th]:px-4 [&_td]:px-4 [&_td]:py-3"
    >
      <TableHeader role="rowgroup" className="sr-only @4xl/directory:not-sr-only">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} role="row">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                id={`${tableId}-${header.column.id}`}
                role="columnheader"
                scope="col"
                className={header.column.id === "actions" ? "w-16" : undefined}
              >
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody role="rowgroup" className="block @4xl/directory:table-row-group">
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            role="row"
            className="flex flex-col py-2 @4xl/directory:table-row @4xl/directory:py-0"
          >
            {row.getAllCells().map((cell) => (
              <TableCell
                key={cell.id}
                role="cell"
                headers={`${tableId}-${cell.column.id}`}
                className={
                  cell.column.id === "name" || cell.column.id === "title"
                    ? "order-first block min-w-0 font-medium whitespace-normal @4xl/directory:table-cell @4xl/directory:font-normal"
                    : "block min-w-0 whitespace-normal @4xl/directory:table-cell"
                }
              >
                {cell.column.id !== "name" &&
                  cell.column.id !== "title" &&
                  cell.column.id !== "actions" && (
                    <span
                      aria-hidden
                      className="mb-1 block text-xs font-medium text-muted-foreground @4xl/directory:hidden"
                    >
                      {cell.column.columnDef.header as string}
                    </span>
                  )}
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
        {!rows.length && (
          <TableRow role="row" className="block @4xl/directory:table-row">
            <TableCell
              role="cell"
              colSpan={table.getAllLeafColumns().length}
              className="block content-center h-32 text-center text-muted-foreground @4xl/directory:table-cell"
            >
              {emptyText}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
