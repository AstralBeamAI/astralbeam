import { createFileRoute, Navigate } from "@tanstack/react-router"

import { OrganizationApiKeys } from "@/components/auth/api-key/organization-api-keys"
import { ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION } from "@/lib/auth/organization-api-key-configuration"
import { APP_NAME } from "@/lib/constants"

export const Route = createFileRoute(
  "/_authenticated/_organization/organization/api-keys/",
)({
  component: OrganizationApiKeysRoute,
  head: () => ({ meta: [{ title: `API keys · ${APP_NAME}` }] }),
})

function OrganizationApiKeysRoute() {
  const { organizationId } = Route.useRouteContext()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <OrganizationApiKeys
        className="max-w-4xl"
        organizationId={organizationId}
        unauthorized={<Navigate to="/" replace />}
      >
        <div className="max-w-4xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            API keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Owners and developers can manage keys for programmatic organization access.{" "}
            {ORGANIZATION_API_KEY_RATE_LIMIT_DESCRIPTION}
          </p>
          <p className="text-sm text-muted-foreground">
            Generate chat tokens on your server and never expose an API key secret in browser code.
            Secrets are shown only once and cannot be recovered.
          </p>
        </div>
      </OrganizationApiKeys>
    </div>
  )
}
