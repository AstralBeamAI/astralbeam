import { createFileRoute, Navigate } from "@tanstack/react-router"

import { OrganizationApiKeys } from "@/components/auth/api-key/organization-api-keys"
import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute(
  "/_authenticated/_organization/organization/api-keys/",
)({
  component: OrganizationApiKeysRoute,
  head: () => ({ meta: [{ title: `API keys · ${APP_NAME}` }] }),
})

function OrganizationApiKeysRoute() {
  const { organizationId, organizationSlug } = Route.useRouteContext()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <OrganizationApiKeys
        className="max-w-4xl"
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        unauthorized={<Navigate to="/" replace />}
      >
        <div className="max-w-4xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            API keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage API keys. New keys are shown only once.
          </p>
        </div>
      </OrganizationApiKeys>
    </div>
  )
}
