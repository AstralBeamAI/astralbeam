import { hasMemberRole } from "@better-auth-ui/core/plugins/organization"
import { useAuthPlugin } from "@better-auth-ui/react"
import { createFileRoute } from "@tanstack/react-router"

import { OrganizationInvitations } from "@/components/auth/organization/organization-invitations"
import { OrganizationMembers } from "@/components/auth/organization/organization-members"
import { Skeleton } from "@/components/ui/skeleton"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { APP_NAME } from "@/lib/constants"
import { getMembersPageData } from "./-functions/get-members-page-data"

export const Route = createFileRoute("/_authenticated/$orgSlug/members/")({
  loader: ({ params }) => getMembersPageData({ data: { organizationSlug: params.orgSlug } }),
  component: MembersPage,
  pendingComponent: MembersPageSkeleton,
  head: () => ({ meta: [{ title: `Members · ${APP_NAME}` }] }),
})

function MembersPage() {
  const { data, permissions } = Route.useLoaderData()
  const { creatorRole } = useAuthPlugin(organizationPlugin)
  const isOwner = hasMemberRole(data.memberRole, creatorRole)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Members</h1>
        <p className="text-sm text-muted-foreground">
          Manage members and pending invitations for {data.organization.name}.
        </p>
      </div>
      <div className="flex flex-col gap-4 md:gap-6">
        <OrganizationMembers
          pageSize={20}
          organization={data.organization}
          memberRole={data.memberRole}
          canInvite={permissions.createInvitation}
          canUpdateMember={permissions.updateMember}
          canRemoveMember={permissions.deleteMember}
        />
        <OrganizationInvitations
          organizationId={data.organization.id}
          isOwner={isOwner}
          canInvite={permissions.createInvitation}
          canCancelInvitation={permissions.cancelInvitation}
        />
      </div>
    </div>
  )
}

function MembersPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
