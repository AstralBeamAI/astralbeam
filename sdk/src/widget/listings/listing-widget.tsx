import { useId, useRef, useState } from "react"
import { useInfiniteQuery, useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query"
import { useDebouncedValue } from "@tanstack/react-pacer"
import { ArrowClockwiseIcon, BuildingsIcon, UsersIcon } from "@phosphor-icons/react"
import {
  type TenantPage,
  type TenantRecordEncoded,
  type TenantUserPage,
} from "../../api/generated/api.ts"
import type {
  MountAstralBeamTenantListOptions,
  MountAstralBeamTenantUserListOptions,
} from "../../client/listings.ts"
import { isAstralBeamApiError } from "../../api/api.ts"
import { Button } from "../components/ui/button.tsx"
import { Input } from "../components/ui/input.tsx"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../components/ui/combobox.tsx"
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx"
import { Skeleton } from "../components/ui/skeleton.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import {
  type ListingPageOptions,
  type ListingSession,
  loadListingPage,
  loadTenantChoices,
  resolveListingTenant,
} from "../../core/listings.ts"
import { DirectoryTable } from "./table.tsx"

type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
interface WidgetProps {
  options: Options
  kind: "tenants" | "users"
  session: ListingSession
}
type Cursor = ListingPageOptions["cursor"]

export function ListingWidget({ options, kind, session }: WidgetProps) {
  const queryClient = useQueryClient()
  const fetching = useIsFetching()
  const [selectedTenant, setSelectedTenant] = useState<TenantRecordEncoded | null>(null)
  const [search, setSearch] = useState("")
  const [q] = useDebouncedValue(search.trim(), { wait: 300 })
  const [admin, setAdmin] = useState<"all" | "true" | "false">("all")
  const adminFilter = options.showAdmin ? admin : "all"
  const [size, setSize] = useState(options.pageSize ?? 20)
  const [initialSize, setInitialSize] = useState(options.pageSize)
  if (initialSize !== options.pageSize) {
    setInitialSize(options.pageSize)
    setSize(options.pageSize ?? 20)
  }
  const scope = options.scope ?? "tenant"
  const pinned = options.tenantId !== undefined || options.tenantExternalId !== undefined
  const resolve = pinned || (kind === "users" && scope === "tenant")
  const tenant = useQuery({
    queryKey: ["identity-tenant", options.tenantId, options.tenantExternalId],
    enabled: resolve,
    queryFn: ({ signal }) => resolveListingTenant(session, signal),
  })
  const currentTenant = resolve ? tenant.data : selectedTenant
  const tenantId = currentTenant?.id
  const needsPicker = kind === "users" && scope === "organization" && !pinned
  const awaitingTenant = (kind === "users" || pinned) && !tenantId
  const title = options.title ?? (kind === "tenants" ? "Tenants" : "Tenant users")
  return (
    <section
      data-slot="directory"
      aria-label={title}
      className="flex h-full flex-col gap-4 overflow-auto text-foreground"
    >
      {options.showHeader !== false && (
        <header data-slot="directory-header" className="flex items-center gap-3">
          {kind === "tenants"
            ? <BuildingsIcon size={22} aria-hidden />
            : <UsersIcon size={22} aria-hidden />}
          <div>
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {currentTenant
                ? `${
                  currentTenant.name || currentTenant.external_id
                } · ${currentTenant.external_id}`
                : scope === "tenant"
                ? "Current tenant"
                : "Current organization"} · Read-only directory
            </p>
          </div>
        </header>
      )}
      {needsPicker && (
        <TenantPicker
          session={session}
          selected={selectedTenant}
          onSelect={(tenant) => {
            if (tenant?.id === selectedTenant?.id) return
            setSelectedTenant(tenant)
            options.onTenantChange?.(tenant)
          }}
        />
      )}
      <div data-slot="directory-toolbar" className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          disabled={awaitingTenant}
          aria-label="Search by name or external ID"
          placeholder="Search by name or external ID…"
          value={search}
          maxLength={255}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-w-0 sm:w-72"
        />
        {kind === "users" && options.showAdmin && (
          <NativeSelect
            disabled={awaitingTenant}
            aria-label="Stored admin status"
            value={admin}
            onChange={(e) => setAdmin(e.target.value as typeof admin)}
          >
            <NativeSelectOption value="all">All users</NativeSelectOption>
            <NativeSelectOption value="true">Admins</NativeSelectOption>
            <NativeSelectOption value="false">Non-admins</NativeSelectOption>
          </NativeSelect>
        )}
        <div data-slot="directory-page-controls" className="flex items-center gap-2 sm:ms-auto">
          <NativeSelect
            disabled={awaitingTenant}
            aria-label="Rows per page"
            value={size}
            onChange={(e) => setSize(Number(e.target.value) as typeof size)}
          >
            {[20, 50, 100].map((value) => (
              <NativeSelectOption key={value} value={value}>{value} per page</NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh directory"
            title="Refresh directory"
            disabled={fetching > 0}
            onClick={() => void queryClient.refetchQueries({ type: "active" })}
          >
            <ArrowClockwiseIcon
              aria-hidden
              className={fetching > 0 ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          </Button>
        </div>
      </div>
      {resolve && tenant.isError
        ? (
          <ListingError
            error={tenant.error}
            retry={() => void tenant.refetch()}
          />
        )
        : resolve && tenant.isPending
        ? <ListingLoading />
        : awaitingTenant
        ? (
          <div
            data-slot="directory-empty"
            className="space-y-3 rounded-lg border border-foreground/10 bg-card p-8 text-center text-card-foreground"
          >
            <p role="status" className="text-muted-foreground">
              {needsPicker
                ? "Select a tenant to view its users."
                : "No persisted tenant found. Create the tenant, then refresh."}
            </p>
          </div>
        )
        : (
          <DirectoryPage
            key={JSON.stringify([tenantId, q, adminFilter, size])}
            admin={adminFilter}
            {...{
              options,
              kind,
              session,
              tenantId,
              q,
              size,
            }}
          />
        )}
    </section>
  )
}

function TenantPicker(
  { session, selected, onSelect }: {
    session: ListingSession
    selected: TenantRecordEncoded | null
    onSelect: (tenant: TenantRecordEncoded | null) => void
  },
) {
  const inputId = useId()
  const [text, setText] = useState("")
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  const container = useRef<HTMLDivElement>(null)
  const query = useInfiniteQuery({
    queryKey: ["tenant-picker", search],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      loadTenantChoices(
        session,
        { q: search, ...(pageParam ? { page_after: pageParam } : {}) },
        signal,
      ),
    getNextPageParam: (page) => page.page_after ?? undefined,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div
      ref={container}
      data-slot="directory-tenant-picker"
      className="w-full space-y-1.5 sm:max-w-sm"
    >
      <label
        htmlFor={inputId}
        data-slot="directory-tenant-label"
        className="block text-sm font-medium"
      >
        Tenant
      </label>
      <Combobox
        items={items}
        filter={null}
        value={selected}
        onValueChange={onSelect}
        itemToStringLabel={(item) => `${item.name || item.external_id} · ${item.external_id}`}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onInputValueChange={(value, details) => {
          if (details.reason === "input-change" || details.reason === "clear-press") setText(value)
        }}
        onOpenChange={(open) => {
          if (!open) setText("")
        }}
      >
        <ComboboxInput
          id={inputId}
          aria-label="Tenant"
          placeholder="Find a tenant…"
          maxLength={255}
          showClear
          className="[&_[data-slot=input-group-addon]]:me-0"
        />
        <ComboboxContent container={container}>
          {!query.isError && (
            <ComboboxEmpty>
              {query.isPending ? "Loading tenants…" : "No tenants match."}
            </ComboboxEmpty>
          )}
          <ComboboxList>
            {(item: TenantRecordEncoded) => (
              <ComboboxItem key={item.id} value={item}>
                {item.name || item.external_id} · {item.external_id}
              </ComboboxItem>
            )}
          </ComboboxList>
          {query.isError && <ListingError error={query.error} retry={() => void query.refetch()} />}
          {query.hasNextPage && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more tenants"}
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

function DirectoryPage(
  { options, kind, session, tenantId, q, admin, size }:
    & WidgetProps
    & { tenantId: string | undefined; q: string; admin: "all" | "true" | "false"; size: number },
) {
  const [cursor, setCursor] = useState<Cursor>({})
  const query = useQuery<TenantPage | TenantUserPage>({
    queryKey: [kind, tenantId, q, admin, size, cursor],
    queryFn: ({ signal }) =>
      loadListingPage(session, { kind, tenantId, q, admin, size, cursor }, signal),
  })
  return (
    <div data-slot="directory-page" aria-busy={query.isFetching} className="min-w-0 space-y-4">
      {query.isError
        ? (
          <ListingError
            error={query.error}
            retry={() => void query.refetch()}
          />
        )
        : query.isPending
        ? <ListingLoading />
        : (
          <div
            data-slot="directory-table"
            className="overflow-hidden rounded-lg border border-foreground/10 bg-card text-card-foreground"
          >
            <DirectoryTable
              key={JSON.stringify(cursor)}
              rows={query.data.items}
              kind={kind}
              options={options}
              filtered={!!q || admin !== "all"}
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

function PageNavigation(
  { page, busy, onPage }: {
    page: TenantPage | TenantUserPage | undefined
    busy: boolean
    onPage: (cursor: Cursor) => void
  },
) {
  return (
    <nav aria-label="Directory pages" className="grid grid-cols-2 justify-end gap-2 sm:flex">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !page?.page_before}
        onClick={() => onPage({ page_before: page!.page_before! })}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !page?.page_after}
        onClick={() => onPage({ page_after: page!.page_after! })}
      >
        Next
      </Button>
    </nav>
  )
}

function ListingLoading() {
  return (
    <div role="status" aria-label="Loading directory" className="space-y-3 p-4">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  )
}

function ListingError({ error, retry }: { error: Error; retry: () => void }) {
  const apiError = isAstralBeamApiError(error) ? error : undefined
  const status = apiError?.status
  const titles: Record<number, string> = {
    401: "Authentication required",
    403: "Access denied",
    404: "Tenant not found",
    429: "Too many requests",
  }
  const retryAfter = apiError?.headers.get("retry-after")
  return (
    <Alert variant="destructive">
      <AlertTitle>{titles[status ?? 0] ?? "Unable to load directory"}</AlertTitle>
      <AlertDescription>
        {status === 429 ? `Please retry after ${retryAfter ?? "a few"} seconds.` : error.message}
      </AlertDescription>
      <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
    </Alert>
  )
}
