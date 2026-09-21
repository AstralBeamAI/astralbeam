import { WarningCircleIcon } from "@phosphor-icons/react"
import { createFileRoute, Link } from "@tanstack/react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { DashboardResourceCards } from "./-components/dashboard-resource-cards"
import { getDashboardPageData } from "./-functions/get-dashboard-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/")({
  loader: ({ params }) => getDashboardPageData({ data: { organizationSlug: params.orgSlug } }),
  component: DashboardPage,
  pendingComponent: DashboardPageSkeleton,
  head: () => ({ meta: [{ title: `Dashboard · ${APP_NAME}` }] }),
})

function DashboardPage() {
  const { orgSlug } = Route.useParams()
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {data.openaiApiKeyConfigured === false && (
        <Alert variant="destructive" className="max-w-4xl rounded-lg">
          <WarningCircleIcon aria-hidden="true" />
          <AlertTitle>This organization has no OpenAI API key</AlertTitle>
          <AlertDescription>
            Every embedded chat message is refused until one is set. {permissions.updateOrganization
              ? (
                <>
                  <Link to="/$orgSlug/settings" params={{ orgSlug }}>
                    Configure the OpenAI API key
                  </Link>{" "}
                  in the organization settings.
                </>
              )
              : "Ask an owner to add one in the organization settings."}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {data.organizationName}
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Configure the agents this organization embeds with {APP_NAME}.
        </p>
      </div>
      <DashboardResourceCards organizationSlug={orgSlug} counts={data.counts} />
    </div>
  )
}

function DashboardPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}
