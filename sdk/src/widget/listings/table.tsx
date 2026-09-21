import { Fragment, useMemo } from "react"
import { type ColumnDef, rowExpandingFeature, tableFeatures, useTable } from "@tanstack/react-table"
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

const features = tableFeatures({ rowExpandingFeature })
type RecordRow = TenantRecordEncoded | TenantUserRecordEncoded
type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions

export function DirectoryTable(
  { rows, kind, options, filtered }: {
    rows: RecordRow[]
    kind: "tenants" | "users"
    options: Options
    filtered: boolean
  },
) {
  const columns = useMemo<ColumnDef<typeof features, RecordRow>[]>(() => [
    {
      accessorKey: "external_id",
      header: "ID",
      cell: ({ row }) => (
        <span className="block max-w-64 break-all font-mono text-xs">
          {row.original.external_id}
        </span>
      ),
    },
    {
      id: "name",
      header: kind === "tenants" ? "Tenant" : "User",
      cell: ({ row, table }) => {
        const record = row.original
        const name = record.name || record.external_id
        return (
          <div className="flex items-center gap-3 py-1">
            {kind === "users" && (
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
              >
                {name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("")}
              </span>
            )}
            <Button
              variant="link"
              className="h-auto max-w-64 justify-start p-0 text-start whitespace-normal break-words"
              onClick={() => table.setExpanded(row.getIsExpanded() ? {} : { [row.id]: true })}
              aria-expanded={row.getIsExpanded()}
            >
              {name}
            </Button>
          </div>
        )
      },
    },
    ...(kind === "users" && options.showAdmin
      ? [{
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
      }]
      : []),
    {
      accessorKey: "metadata",
      header: "Metadata",
      cell: ({ row }) => {
        const entries = Object.entries(row.original.metadata)
        return entries.length
          ? (
            <dl className="max-w-72 space-y-1 text-xs">
              {entries.slice(0, 3).map(([key, value]) => (
                <div key={key} className="flex gap-1">
                  <dt className="max-w-24 shrink-0 truncate text-muted-foreground">{key}:</dt>
                  <dd className="truncate">
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
              {entries.length > 3 && (
                <div className="text-muted-foreground">
                  <dt className="sr-only">Additional metadata</dt>
                  <dd>+{entries.length - 3} more in details</dd>
                </div>
              )}
            </dl>
          )
          : <span className="text-muted-foreground">No metadata</span>
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
    ...((kind === "users" ? options.onTenantUserSelect : options.onTenantSelect)
      ? [{
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
                  ? options.onTenantUserSelect?.(record)
                  : options.onTenantSelect?.(record)}
              aria-label={`Open ${record.name || record.external_id}`}
              title="Open"
            >
              <CaretRightIcon aria-hidden />
            </Button>
          )
        },
      }]
      : []),
  ], [kind, options.onTenantSelect, options.onTenantUserSelect, options.showAdmin])
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getRowCanExpand: () => true,
  })
  return (
    <Table>
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
          <Fragment key={row.id}>
            <TableRow>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
            {row.getIsExpanded() && (
              <TableRow>
                <TableCell colSpan={row.getAllCells().length}>
                  <dl className="space-y-2 break-all p-3 text-sm">
                    <dt className="font-medium">Metadata</dt>
                    <dd>
                      <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap">{JSON.stringify(row.original.metadata, null, 2)}</pre>
                    </dd>
                  </dl>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
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
