import { useMemo } from "react"
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
          <span className="block w-72 break-all font-mono text-xs whitespace-normal">
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
            <div className="flex min-w-48 items-center gap-3 py-1">
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
              <span className="max-w-64 text-start whitespace-normal break-words">{name}</span>
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
            <dl className="min-w-32 max-w-72 space-y-1 text-xs">
              {entries.map(([key, value]) => (
                <div key={key} className="flex gap-1">
                  <dt className="max-w-24 shrink-0 break-all text-muted-foreground">{key}:</dt>
                  <dd className="min-w-0 break-words">
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
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId: (row) => row.id,
  })
  return (
    <Table className="[&_th]:h-12 [&_th]:px-4 [&_td]:px-4 [&_td]:py-3">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id}>
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
        {!rows.length && (
          <TableRow>
            <TableCell
              colSpan={table.getAllLeafColumns().length}
              className="h-32 text-center text-muted-foreground"
            >
              {filtered ? "No records match your filters." : "No records yet."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
