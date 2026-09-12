import { createFileRoute, redirect } from "@tanstack/react-router"

import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { OrganizationOpenaiApiKeyCard } from "./-components/organization-openai-api-key-card"
import { OrganizationSettingsForm } from "./-components/organization-settings-form"
import { getOrganizationSettingsPageData } from "./-functions/get-organization-settings-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/settings/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.updateOrganization) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) =>
    getOrganizationSettingsPageData({ data: { organizationSlug: params.orgSlug } }),
  component: OrganizationSettingsPage,
  pendingComponent: OrganizationSettingsPageSkeleton,
  head: () => ({ meta: [{ title: `Organization settings · ${APP_NAME}` }] }),
})

function OrganizationSettingsPage() {
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Organization settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Update this organization's name, URL slug, and model provider key.
        </p>
      </div>
      <OrganizationSettingsForm
        organizationSlug={data.organization.slug}
        organizationName={data.organization.name}
        readOnly={!permissions.updateOrganization}
      />
      <OrganizationOpenaiApiKeyCard
        organizationSlug={data.organization.slug}
        configured={data.openaiApiKeyConfigured}
        readOnly={!permissions.updateConfiguration}
      />
    </div>
  )
}

function OrganizationSettingsPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-72 w-full max-w-2xl rounded-xl" />
      <Skeleton className="h-64 w-full max-w-2xl rounded-xl" />
    </div>
  )
}
