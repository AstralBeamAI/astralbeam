import { createFileRoute, redirect } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { OrganizationDirectory } from "../-components/organization-directory"

export const Route = createFileRoute("/_authenticated/$orgSlug/threads/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readTenants) {
      throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug }, replace: true })
    }
  },
  component: () => <OrganizationDirectory kind="threads" />,
  head: () => ({ meta: [{ title: `Conversations · ${APP_NAME}` }] }),
})
