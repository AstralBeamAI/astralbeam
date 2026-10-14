import { CopyIcon, GaugeIcon, PlusIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { APP_NAME } from "@/lib/constants"
import { getUsageLimitsPageData } from "./-functions/get-usage-limits-page-data"
import { usageLimitScopeItems } from "./-lib/constants"
import { copyUsageLimitId, describeUsageLimitWindow, formatUsageLimitAmount } from "./-lib/utils"

export const Route = createFileRoute("/_authenticated/$orgSlug/usage-limits/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) => getUsageLimitsPageData({ data: { organizationSlug: params.orgSlug } }),
  component: UsageLimitsPage,
  pendingComponent: UsageLimitsPageSkeleton,
  head: () => ({ meta: [{ title: `Usage Limits · ${APP_NAME}` }] }),
})

function UsageLimitsPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Usage Limits</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cap the tokens or spend that chat can use. Default limits apply to every tenant user.
            Others apply only when your server lists their IDs in a chat token.
          </p>
        </div>
        {permissions.updateConfiguration && (
          <Link to="/$orgSlug/usage-limits/new" params={{ orgSlug }} className={buttonVariants()}>
            <PlusIcon aria-hidden="true" />
            Add limit
          </Link>
        )}
      </div>

      {data.usageLimits.length === 0 ? (
        <Empty className="max-w-4xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GaugeIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No usage limits yet</EmptyTitle>
            <EmptyDescription>
              Without limits, chat can use any number of tokens. Add one to cap usage per tenant,
              tenant user, or conversation.
            </EmptyDescription>
          </EmptyHeader>
          {permissions.updateConfiguration && (
            <EmptyContent>
              <Link
                to="/$orgSlug/usage-limits/new"
                params={{ orgSlug }}
                className={buttonVariants({ size: "sm" })}
              >
                Add limit
              </Link>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table aria-label="Usage limits">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-end">Limit</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">ID</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.usageLimits.map((limit) => (
                <TableRow key={limit.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/$orgSlug/usage-limits/$usageLimitId"
                      params={{ orgSlug, usageLimitId: limit.id }}
                      className="hover:underline"
                    >
                      {limit.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {usageLimitScopeItems.find((item) => item.value === limit.scope)?.label}
                  </TableCell>
                  <TableCell>{describeUsageLimitWindow(limit)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatUsageLimitAmount(limit)}
                  </TableCell>
                  <TableCell>{limit.appliesByDefault ? "Everyone" : "Listed in token"}</TableCell>
                  <TableCell>
                    <Badge variant={limit.enabled ? "secondary" : "outline"}>
                      {limit.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Copy ID of ${limit.name}`}
                      title={`Copy ID: ${limit.id}`}
                      onClick={() => void copyUsageLimitId(limit.id)}
                    >
                      <CopyIcon aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function UsageLimitsPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
