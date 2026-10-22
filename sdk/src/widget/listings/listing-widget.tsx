import { useId, useState } from "react"
import { useIsFetching, useQuery } from "@tanstack/react-query"
import { useDebouncedValue } from "@tanstack/react-pacer"
import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  ChatsIcon,
  FunnelXIcon,
  UsersIcon,
} from "@phosphor-icons/react"
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
import { authenticationState } from "../../core/auth.ts"
import { TooltipButton } from "../components/tooltip-button.tsx"
import { Button } from "../components/ui/button.tsx"
import { Input } from "../components/ui/input.tsx"
import { SearchDropdown } from "../components/search-dropdown.tsx"
import { NativeSelect, NativeSelectOption } from "../components/ui/native-select.tsx"
import { Skeleton } from "../components/ui/skeleton.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"
import {
  type ListingPageOptions,
  type ListingSession,
  loadListingPage,
  loadTenantChoices,
  loadTenantUserUsage,
  resolveListingTenant,
} from "../../core/listings.ts"
import { ThreadDirectoryPage } from "./thread-directory.tsx"
import { DirectoryTable } from "./table.tsx"
import { type ListingCompletion, useListingCompletion } from "../lib/listing-completion.ts"
import { usagePeriods, usagePeriodRange, type UsagePeriod } from "./usage-period.ts"

const listingKinds = {
  tenants: {
    title: "Tenants",
    searchLabel: "Search by name or external ID",
    Icon: BuildingsIcon,
    tenantPrompt: null,
    showAdminFilter: false,
  },
  users: {
    title: "Tenant users",
    searchLabel: "Search by name or external ID",
    Icon: UsersIcon,
    tenantPrompt: "Select a tenant to view its users.",
    showAdminFilter: true,
  },
  threads: {
    title: "Conversations",
    Icon: ChatsIcon,
    searchLabel: "Search conversations",
    tenantPrompt: "Select a tenant to view its conversations.",
    showAdminFilter: false,
  },
} as const

type Options = MountAstralBeamTenantListOptions & MountAstralBeamTenantUserListOptions
interface WidgetProps {
  options: Options
  kind: keyof typeof listingKinds
  session: ListingSession
  onRefresh: () => Promise<void>
  onComplete: ListingCompletion
}
type Cursor = ListingPageOptions["cursor"]

export function ListingWidget({ options, kind, session, onRefresh, onComplete }: WidgetProps) {
  const config = listingKinds[kind]
  const { Icon } = config
  const requiresTenant = config.tenantPrompt !== null
  const fetching = useIsFetching()
  const fetchingRows = useIsFetching({ queryKey: [kind] })
  const [selectedTenant, setSelectedTenant] = useState<TenantRecordEncoded | null>(null)
  const [usagePeriod, setUsagePeriod] = useState<UsagePeriod>("month")
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
  const resolve = pinned || (requiresTenant && scope === "tenant")
  const tenant = useQuery({
    queryKey: ["identity-tenant", options.tenantId, options.tenantExternalId],
    enabled: resolve,
    queryFn: ({ signal }) => resolveListingTenant(session, signal),
  })
  const currentTenant = resolve ? tenant.data : selectedTenant
  const tenantId = currentTenant?.id
  const needsPicker = requiresTenant && scope === "organization" && !pinned
  const awaitingTenant = (requiresTenant || resolve) && !tenantId
  const pending = resolve && (tenant.isPending || tenant.fetchStatus !== "idle")
  useListingCompletion(
    awaitingTenant || (resolve && tenant.isError) ? onComplete : undefined,
    pending,
    resolve ? tenant.error : null,
  )
  const title = options.title ?? config.title
  return (
    <section
      data-slot="directory"
      aria-label={title}
      className="@container/directory flex h-full min-w-0 flex-col gap-4 overflow-y-auto text-foreground"
    >
      {options.showHeader !== false && (
        <header data-slot="directory-header" className="flex items-center gap-3">
          <Icon size={22} aria-hidden />
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 className="font-heading text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {currentTenant
                ? currentTenant.name && currentTenant.name !== currentTenant.external_id
                  ? `${currentTenant.name} · ${currentTenant.external_id}`
                  : currentTenant.external_id
                : scope === "tenant"
                  ? "Current tenant"
                  : "Current organization"}{" "}
              · Read-only directory
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
          aria-label={config.searchLabel}
          placeholder={`${config.searchLabel}…`}
          value={search}
          maxLength={255}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-w-0 max-w-full @lg/directory:w-72"
        />
        {config.showAdminFilter && options.showAdmin && (
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
        {(search || adminFilter !== "all") && (
          <TooltipButton
            variant="ghost"
            size="icon-sm"
            tooltip="Clear filters"
            onClick={() => {
              setSearch("")
              setAdmin("all")
            }}
          >
            <FunnelXIcon aria-hidden />
          </TooltipButton>
        )}
        <div
          data-slot="directory-page-controls"
          className="ms-auto flex shrink-0 items-center gap-2"
        >
          <NativeSelect
            disabled={awaitingTenant || fetchingRows > 0}
            aria-label="Rows per page"
            className="min-w-32"
            value={size}
            onChange={(e) => setSize(Number(e.target.value) as 20 | 50 | 100)}
          >
            {[20, 50, 100].map((value) => (
              <NativeSelectOption key={value} value={value}>
                {value} per page
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <TooltipButton
            variant="outline"
            size="icon"
            tooltip="Refresh directory"
            disabled={fetching > 0}
            onClick={() => void onRefresh().catch(() => {})}
          >
            <ArrowClockwiseIcon
              aria-hidden
              className={fetching > 0 ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          </TooltipButton>
        </div>
      </div>
      {resolve && tenant.isError ? (
        <ListingError error={tenant.error} retry={() => void tenant.refetch()} />
      ) : resolve && tenant.isPending ? (
        <ListingLoading />
      ) : awaitingTenant ? (
        <div
          data-slot="directory-empty"
          className="space-y-3 rounded-lg border border-foreground/10 bg-card p-8 text-center text-card-foreground"
        >
          <p role="status" className="text-muted-foreground">
            {needsPicker
              ? config.tenantPrompt
              : "This tenant is not available. Contact your app’s support team if you expected to see records here."}
          </p>
        </div>
      ) : kind === "threads" ? (
        <ThreadDirectoryPage
          key={JSON.stringify([tenantId, q, size])}
          session={session}
          tenantId={tenantId}
          q={q}
          size={size}
          ErrorFeedback={ListingError}
          LoadingFeedback={ListingLoading}
          Pagination={PageNavigation}
          onComplete={pending ? undefined : onComplete}
        />
      ) : (
        <DirectoryPage
          key={JSON.stringify([tenantId, q, adminFilter, size])}
          admin={adminFilter}
          {...{ options, kind, session, tenantId, q, size, usagePeriod, setUsagePeriod }}
          onComplete={pending ? undefined : onComplete}
        />
      )}
    </section>
  )
}

function TenantPicker({
  session,
  selected,
  onSelect,
}: {
  session: ListingSession
  selected: TenantRecordEncoded | null
  onSelect: (tenant: TenantRecordEncoded | null) => void
}) {
  const inputId = useId()
  return (
    <div
      data-slot="directory-tenant-picker"
      className="w-full min-w-0 space-y-1.5 [&_input]:min-w-0 [&_[data-slot=input-group-addon]]:me-0 @lg/directory:max-w-sm"
    >
      <label
        htmlFor={inputId}
        data-slot="directory-tenant-label"
        className="block text-sm font-medium"
      >
        Tenant
      </label>
      <SearchDropdown
        id={inputId}
        label="Tenant"
        placeholder="Search tenants…"
        value={selected}
        onValueChange={onSelect}
        showClear
        itemLabel={(item) =>
          item.name && item.name !== item.external_id
            ? `${item.name} · ${item.external_id}`
            : item.external_id
        }
        loadPage={(q, cursor, signal) =>
          loadTenantChoices(session, { q, ...(cursor ? { page_after: cursor } : {}) }, signal)
        }
      />
    </div>
  )
}

function DirectoryPage({
  options,
  kind,
  session,
  tenantId,
  q,
  admin,
  size,
  usagePeriod,
  setUsagePeriod,
  onComplete,
}: Omit<WidgetProps, "kind" | "onRefresh"> & {
  kind: "tenants" | "users"
  tenantId: string | undefined
  q: string
  admin: "all" | "true" | "false"
  size: number
  usagePeriod: UsagePeriod
  setUsagePeriod: (period: UsagePeriod) => void
}) {
  const [cursor, setCursor] = useState<Cursor>({})
  const query = useQuery<TenantPage | TenantUserPage>({
    queryKey: [kind, tenantId, q, admin, size, cursor],
    queryFn: ({ signal }) =>
      loadListingPage(session, { kind, tenantId, q, admin, size, cursor }, signal),
  })
  const auth = authenticationState(session.auth)
  const userIds = query.data?.items.map(({ id }) => id).toSorted() ?? []
  const currentRange = usagePeriodRange(usagePeriod)
  const rolling = usagePeriod.startsWith("last")
  const usageEnabled =
    kind === "users" &&
    !!tenantId &&
    userIds.length > 0 &&
    !query.isError &&
    auth.status === "ready" &&
    auth.currentUser.scope === "organization" &&
    auth.currentUser.user.role.split(",").some((role) => role === "owner" || role === "developer")
  const usage = useQuery({
    // Rolling presets reuse fresh results, while each fetch resolves a new cutoff.
    // https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
    queryKey: [
      "tenant-user-usage",
      session.auth.apiUrl,
      session.identity,
      tenantId,
      userIds,
      usagePeriod,
      rolling ? null : currentRange,
    ],
    enabled: usageEnabled,
    gcTime: 60_000,
    queryFn: async ({ signal, client }) => {
      try {
        return await loadTenantUserUsage(
          session,
          tenantId!,
          { user_ids: userIds.join(","), ...usagePeriodRange(usagePeriod) },
          signal,
        )
      } catch (error) {
        if (isAstralBeamApiError(error) && [401, 403].includes(error.status))
          client.removeQueries({ queryKey: ["tenant-user-usage"], type: "inactive" })
        throw error
      }
    },
  })
  const range = usage.data ?? currentRange
  const usageDenied = isAstralBeamApiError(usage.error) && [401, 403].includes(usage.error.status)
  useListingCompletion(
    onComplete,
    query.isPending ||
      query.fetchStatus !== "idle" ||
      (usageEnabled && (usage.isPending || usage.fetchStatus !== "idle")),
    query.error ?? (usageEnabled ? usage.error : null),
  )
  return (
    <div data-slot="directory-page" aria-busy={query.isFetching} className="min-w-0 space-y-4">
      {usageEnabled && !usageDenied && (
        <div
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
          title="Uses provider-reported costs when available, otherwise current configured token rates. Deleted conversations are excluded."
        >
          <NativeSelect
            aria-label="Usage period"
            value={usagePeriod}
            onChange={(event) => setUsagePeriod(event.target.value as UsagePeriod)}
          >
            {Object.entries(usagePeriods).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span>
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              ...(rolling ? { timeStyle: "short" as const } : {}),
              timeZone: "UTC",
            }).formatRange(new Date(range.start), new Date(Date.parse(range.end) - 1))}{" "}
            · UTC
          </span>
        </div>
      )}
      {query.isError ? (
        <ListingError error={query.error} retry={() => void query.refetch()} />
      ) : query.isPending ? (
        <ListingLoading />
      ) : (
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
            usage={
              usageEnabled && !usageDenied
                ? {
                    costs: new Map(
                      usage.isError
                        ? []
                        : usage.data?.items.map((item) => [item.tenant_user_id, item.cost_usd]),
                    ),
                    loading: usage.isPending,
                  }
                : undefined
            }
          />
        </div>
      )}
      {usageEnabled && usage.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading usage…
        </p>
      )}
      {usageEnabled && usage.isError && (
        <ListingError
          title="Unable to load usage"
          error={usage.error}
          retry={() => void usage.refetch()}
        />
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

function PageNavigation({
  page,
  busy,
  onPage,
}: {
  page: { page_before: string | null; page_after: string | null } | undefined
  busy: boolean
  onPage: (cursor: Cursor) => void
}) {
  return (
    <nav
      aria-label="Directory pages"
      className="grid grid-cols-2 gap-2 @lg/directory:flex @lg/directory:justify-end"
    >
      <Button
        variant="outline"
        size="sm"
        className="any-pointer-coarse:min-h-11"
        disabled={busy || !page?.page_before}
        onClick={() => onPage({ page_before: page!.page_before! })}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="any-pointer-coarse:min-h-11"
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
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function ListingError({
  error,
  retry,
  title,
}: {
  error: Error
  retry: () => void
  title?: string
}) {
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
      <AlertTitle>{title ?? titles[status ?? 0] ?? "Unable to load directory"}</AlertTitle>
      <AlertDescription>
        {status === 429 ? `Please retry after ${retryAfter ?? "a few"} seconds.` : error.message}
      </AlertDescription>
      <TooltipButton variant="outline" size="icon-sm" tooltip="Retry" onClick={retry}>
        <ArrowClockwiseIcon aria-hidden />
      </TooltipButton>
    </Alert>
  )
}
