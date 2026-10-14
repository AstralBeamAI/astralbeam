import { ArrowLeftIcon, CopyIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import * as Schema from "effect/Schema"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { UsageLimitIdSchema } from "@/lib/usage-limits/schemas"
import { UsageLimitForm } from "../-components/usage-limit-form"
import { copyUsageLimitId, lastUsageLimitSubjectsPage } from "../-lib/utils"
import { UsageLimitActions } from "./-components/usage-limit-actions"
import { UsageLimitSubjects } from "./-components/usage-limit-subjects"
import { getUsageLimitPageData } from "./-functions/get-usage-limit-page-data"

/** A hand-typed ID that cannot exist should 404 here rather than fail the loader's validator. */
const isUsageLimitId = Schema.is(UsageLimitIdSchema)

export const Route = createFileRoute("/_authenticated/$orgSlug/usage-limits/$usageLimitId/")({
  validateSearch: (search): { page?: number } => {
    const page = Number(search["page"])
    return Number.isInteger(page) && page > 1 ? { page } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  beforeLoad: ({ context, params }) => {
    if (!isUsageLimitId(params.usageLimitId)) throw notFound()
    if (!context.organization.permissions.readConfiguration) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: async ({ params, deps }) => {
    const page = await getUsageLimitPageData({
      data: {
        organizationSlug: params.orgSlug,
        usageLimitId: params.usageLimitId,
        page: deps.page,
      },
    })
    if (!page) throw notFound()
    // Windows end and subjects are deleted between loads, so a page past the end moves to the last.
    const lastPage = lastUsageLimitSubjectsPage(page.data.usage.total)
    if (deps.page > lastPage)
      throw redirect({
        to: "/$orgSlug/usage-limits/$usageLimitId",
        params,
        search: lastPage > 1 ? { page: lastPage } : {},
        replace: true,
      })
    return page
  },
  component: UsageLimitPage,
  pendingComponent: UsageLimitPageSkeleton,
  head: () => ({ meta: [{ title: `Usage limit · ${APP_NAME}` }] }),
})

function UsageLimitPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()
  const { page } = Route.useLoaderDeps()
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

      {!usageLimit.appliesByDefault && (
        <Alert className="max-w-2xl">
          <AlertTitle>Applied when a chat token lists it</AlertTitle>
          <AlertDescription>
            <p>
              Add its ID to the <code>usageLimits</code> option when your server mints a chat token
              for a tenant user it should apply to:
            </p>
            <pre className="mt-2 bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
              {`usageLimits: ["${usageLimit.id}"]`}
            </pre>
          </AlertDescription>
        </Alert>
      )}

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

      <UsageLimitSubjects
        organizationSlug={orgSlug}
        usageLimit={usageLimit}
        usage={data.usage}
        page={page}
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
