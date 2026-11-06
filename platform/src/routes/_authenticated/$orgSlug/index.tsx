import { createFileRoute } from "@tanstack/react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { throwOrganizationRouteError } from "./-lib/route-errors"
import { DashboardIntegrationGuide } from "./-components/dashboard-integration-guide"
import { getDashboardPageData } from "./-functions/get-dashboard-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/")({
  loader: ({ params }) =>
    getDashboardPageData({ data: { organizationSlug: params.orgSlug } }).catch((error: unknown) =>
      throwOrganizationRouteError(error, params.orgSlug),
    ),
  component: DashboardPage,
  pendingComponent: DashboardPageSkeleton,
  head: () => ({ meta: [{ title: `Dashboard · ${APP_NAME}` }] }),
})

function DashboardPage() {
  const { orgSlug } = Route.useParams()
  const { organization } = Route.useRouteContext()
  const { data, permissions } = Route.useLoaderData()
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="font-sans text-xl font-semibold tracking-tight">{data.organizationName}</h1>
        <p className="text-sm text-muted-foreground">
          {permissions.updateConfiguration
            ? "Build and manage the AI agents in your app."
            : "View your organization’s setup and customer activity."}
        </p>
      </div>
      <DashboardIntegrationGuide
        key={orgSlug}
        organizationId={organization.organizationId}
        organizationSlug={orgSlug}
        apiUrl={data.apiUrl}
        modelSetup={data.modelSetup}
        usableApiKeyCount={data.usableApiKeyCount}
        hasAppReply={data.hasAppReply}
        markedSteps={data.markedGuideSteps}
        permissions={permissions}
      />
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
      <Skeleton className="h-96 max-w-4xl" />
    </div>
  )
}
