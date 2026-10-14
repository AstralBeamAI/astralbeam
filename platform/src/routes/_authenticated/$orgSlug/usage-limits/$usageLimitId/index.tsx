import { ArrowLeftIcon, CopyIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import * as Schema from "effect/Schema"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { UsageLimitIdSchema } from "@/lib/usage-limits/schemas"
import { UsageLimitForm } from "../-components/usage-limit-form"
import { copyUsageLimitId } from "../-lib/utils"
import { UsageLimitActions } from "./-components/usage-limit-actions"
import { getUsageLimitPageData } from "./-functions/get-usage-limit-page-data"

/** A hand-typed ID that cannot exist should 404 here rather than fail the loader's validator. */
const isUsageLimitId = Schema.is(UsageLimitIdSchema)

export const Route = createFileRoute("/_authenticated/$orgSlug/usage-limits/$usageLimitId/")({
  beforeLoad: ({ context, params }) => {
    if (!isUsageLimitId(params.usageLimitId)) throw notFound()
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: async ({ params }) => {
    const page = await getUsageLimitPageData({
      data: { organizationSlug: params.orgSlug, usageLimitId: params.usageLimitId },
    })
    if (!page) throw notFound()
    return page
  },
  component: UsageLimitPage,
  pendingComponent: UsageLimitPageSkeleton,
  head: () => ({ meta: [{ title: `Usage limit · ${APP_NAME}` }] }),
})

function UsageLimitPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  const { usageLimit } = data

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <Link
          to="/$orgSlug/usage-limits"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Usage Limits
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{usageLimit.name}</h1>
          {!usageLimit.enabled && <Badge variant="outline">Disabled</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs text-muted-foreground">{usageLimit.id}</code>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Copy usage limit ID"
            title="Copy usage limit ID"
            onClick={() => void copyUsageLimitId(usageLimit.id)}
          >
            <CopyIcon aria-hidden="true" />
          </Button>
        </div>
      </div>

      {permissions.deleteConfiguration && (
        <UsageLimitActions organizationSlug={orgSlug} usageLimit={usageLimit} />
      )}

      {/* Remounting on the lock version keeps the editor's local state tied to the snapshot it
        was initialized from, so a save after a conflict cannot carry the stale one forward. */}
      <UsageLimitForm
        key={`${usageLimit.id}:${usageLimit.lockVersion}`}
        organizationSlug={orgSlug}
        usageLimit={usageLimit}
        readOnly={!permissions.updateConfiguration}
      />
    </div>
  )
}

function UsageLimitPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-9 w-24" />
      <Skeleton className="h-[36rem] w-full max-w-2xl rounded-xl" />
    </div>
  )
}
