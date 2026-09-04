// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Support exact optional property types, explicit load errors, total-aware pagination, and colocated list states.

import type { ApiKeyAuthClient } from "@better-auth-ui/core/plugins/api-key"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useListApiKeys } from "@better-auth-ui/react/plugins/api-key"
import { KeyIcon } from "@phosphor-icons/react"
import { Fragment, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemContent, ItemGroup, ItemMedia, ItemSeparator } from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"
import type { OrganizationApiKey } from "@/lib/auth/organization-api-key-configuration"
import { isValidSlug } from "@/lib/slug"
import { cn } from "cn"
import { ApiKey } from "./api-key"
import { CreateApiKeyDialog } from "./create-api-key-dialog"

export type ApiKeysProps = {
  className?: string | undefined
  /** Scope the list and create payload to an organization. */
  organizationId?: string | undefined
  organizationSlug: string
  /** Force the loading skeleton and disable the list query. */
  isPending?: boolean | undefined
  /** Hide the "Create API key" button (header + empty state). */
  hideCreate?: boolean | undefined
  /** Hide the per-row delete button on listed keys. */
  hideDelete?: boolean | undefined
  /** Hide the per-row edit button on listed keys. */
  hideUpdate?: boolean | undefined
}

function ApiKeySkeleton() {
  return (
    <Item>
      <ItemMedia>
        <Skeleton className="size-10 rounded-md" />
      </ItemMedia>
      <ItemContent>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-36" />
      </ItemContent>
    </Item>
  )
}

function ApiKeysEmpty({ onCreatePress, hideCreate }: {
  onCreatePress: () => void
  hideCreate?: boolean | undefined
}) {
  const { localization } = useAuthPlugin(apiKeyPlugin)

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{localization.noApiKeys}</EmptyTitle>
        <EmptyDescription>{localization.apiKeysDescription}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {!hideCreate && (
          <Button size="sm" onClick={onCreatePress}>
            {localization.createApiKey}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}

export function ApiKeys({
  className,
  organizationId,
  organizationSlug,
  isPending: isPendingProp,
  hideCreate,
  hideDelete,
  hideUpdate,
}: ApiKeysProps) {
  const { authClient } = useAuth<ApiKeyAuthClient>()
  const { localization: apiKeyLocalization, pageSize } = useAuthPlugin(apiKeyPlugin)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState("createdAt:desc")
  const [sortBy, sortDirection] = sort.split(":") as [string, "asc" | "desc"]
  const sortItems = [
    { label: apiKeyLocalization.newest, value: "createdAt:desc" },
    { label: apiKeyLocalization.oldest, value: "createdAt:asc" },
    { label: apiKeyLocalization.nameAscending, value: "name:asc" },
    { label: apiKeyLocalization.nameDescending, value: "name:desc" },
  ]

  const {
    data: listData,
    isError: isListError,
    isFetching: isListFetching,
    isPending: isListPending,
    refetch: refetchApiKeys,
  } = useListApiKeys(
    authClient,
    {
      enabled: !isPendingProp,
      query: {
        limit: pageSize,
        offset: page * pageSize,
        sortBy,
        sortDirection,
        ...(organizationId ? { organizationId } : {}),
      },
    },
  )

  const isPending = isPendingProp || isListPending
  const hasInvalidSlug = listData?.apiKeys.some((key) => {
    const slug = (key as { slug?: unknown }).slug
    return typeof slug !== "string" || !isValidSlug(slug)
  }) ?? false
  const organizationApiKeys = hasInvalidSlug
    ? undefined
    : listData?.apiKeys as OrganizationApiKey[] | undefined
  const total = listData?.total ?? 0
  const hasNextPage = (page + 1) * pageSize < total

  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="truncate text-sm font-semibold">
          {apiKeyLocalization.apiKeys}
        </h2>

        {!hideCreate && (
          <Button
            className="shrink-0"
            size="sm"
            disabled={isPending}
            onClick={() => setCreateOpen(true)}
          >
            {apiKeyLocalization.createApiKey}
          </Button>
        )}
      </div>
      <Select
        items={sortItems}
        value={sort}
        onValueChange={(value) => {
          setSort(value ?? "createdAt:desc")
          setPage(0)
        }}
      >
        <SelectTrigger aria-label={apiKeyLocalization.sortBy}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Card className="p-0">
        <CardContent className="p-0">
          {isPending
            ? <ApiKeySkeleton />
            : isListError || hasInvalidSlug
            ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center" role="alert">
                <p className="text-sm text-muted-foreground">
                  API keys could not be loaded.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isListFetching}
                  onClick={() => void refetchApiKeys()}
                >
                  Try again
                </Button>
              </div>
            )
            : !organizationApiKeys?.length
            ? (
              <ApiKeysEmpty
                onCreatePress={() => setCreateOpen(true)}
                hideCreate={hideCreate}
              />
            )
            : (
              <ItemGroup className="gap-0">
                {organizationApiKeys.map((key, index) => (
                  <Fragment key={key.id}>
                    {index > 0 && <ItemSeparator />}
                    <ApiKey
                      apiKey={key}
                      hideDelete={hideDelete}
                      hideUpdate={hideUpdate}
                      onDeleted={() => {
                        if (page > 0 && organizationApiKeys.length === 1) setPage(page - 1)
                      }}
                    />
                  </Fragment>
                ))}
              </ItemGroup>
            )}
        </CardContent>
      </Card>
      {(page > 0 || hasNextPage) && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            {apiKeyLocalization.previousPage}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => setPage((value) => value + 1)}
          >
            {apiKeyLocalization.nextPage}
          </Button>
        </div>
      )}

      {!hideCreate && (
        <CreateApiKeyDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          organizationSlug={organizationSlug}
        />
      )}
    </div>
  )
}
