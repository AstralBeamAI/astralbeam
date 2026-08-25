import { createFileRoute } from "@tanstack/react-router"

import { OrganizationInvitations } from "@/components/auth/organization/organization-invitations"
import { OrganizationMembers } from "@/components/auth/organization/organization-members"

export const Route = createFileRoute(
  "/_authenticated/_organization/organization/members/",
)({ component: OrganizationMembersRoute })

function OrganizationMembersRoute() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Members
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage members and pending invitations for the active organization.
        </p>
      </div>
      <div className="flex flex-col gap-4 md:gap-6">
        <OrganizationMembers pageSize={20} />
        <OrganizationInvitations />
      </div>
    </div>
  )
}
