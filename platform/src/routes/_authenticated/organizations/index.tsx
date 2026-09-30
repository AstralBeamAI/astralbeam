import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import { createFileRoute } from "@tanstack/react-router"

import { Organizations } from "@/components/auth/organization/organizations"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { APP_NAME } from "@/lib/constants"
import { AppShell } from "../-components/app-shell"
import { getUserInvitations } from "../-functions/get-user-invitations"
import { getLandingOrganization } from "../-lib/landing-organization"

export const Route = createFileRoute("/_authenticated/organizations/")({
  // The organization list arrives with the session access every authenticated route reads.
  loader: async ({ context: { access, queryClient } }) => {
    const [invitations, organization] = await Promise.all([
      getUserInvitations(),
      getLandingOrganization(access),
    ])
    queryClient.setQueryData(organizationQueryKeys.userInvitations.list(access.userId), invitations)
    return { organization }
  },
  component: OrganizationsRoute,
  head: () => ({ meta: [{ title: `Organizations · ${APP_NAME}` }] }),
})

function OrganizationsRoute() {
  const { organization } = Route.useLoaderData()

  return (
    <AppShell organization={organization}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Open an organization, accept a pending invitation, or create a new one.
          </p>
        </div>
        <div className="flex flex-col gap-4 md:gap-6">
          <Organizations />
          <UserInvitations />
        </div>
      </div>
    </AppShell>
  )
}
