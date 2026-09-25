import { createFileRoute, redirect } from "@tanstack/react-router"

import { ApiKeys } from "@/components/auth/api-key/api-keys"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME } from "@/lib/constants"
import { getApiKeysPageData } from "./-functions/get-api-keys-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/api-keys/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readApiKey) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  loader: ({ params }) => getApiKeysPageData({ data: { organizationSlug: params.orgSlug } }),
  component: ApiKeysPage,
  pendingComponent: ApiKeysPageSkeleton,
  head: () => ({ meta: [{ title: `API keys · ${APP_NAME}` }] }),
})

function ApiKeysPage() {
  const { data, permissions } = Route.useLoaderData()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Manage API keys. New keys are shown only once.
        </p>
      </div>
      <ApiKeys
        className="max-w-4xl"
        organizationId={data.organizationId}
        hideCreate={!permissions.createApiKey}
        hideUpdate={!permissions.updateApiKey}
        hideDelete={!permissions.deleteApiKey}
      />
    </div>
  )
}

function ApiKeysPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-64 w-full max-w-4xl rounded-xl" />
    </div>
  )
}
