import { createFileRoute, redirect } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { OrganizationDirectory } from "../-components/organization-directory"

export const Route = createFileRoute("/_authenticated/$orgSlug/tenants/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readTenants) {
      redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true, throw: true })
    }
  },
  component: () => <OrganizationDirectory kind="tenants" />,
  head: () => ({ meta: [{ title: `Tenants · ${APP_NAME}` }] }),
})
