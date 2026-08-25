// Added with: deno task ui add @better-auth-ui/organization
// Local changes: expose an invitation-action callback so onboarding can refresh organization access.
import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import { useListUserInvitations } from "@better-auth-ui/react/plugins/organization"
import { Fragment } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { ItemGroup, ItemSeparator } from "@/components/ui/item"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { UserInvitationRow } from "./user-invitation-row"
import { UserInvitationRowSkeleton } from "./user-invitation-row-skeleton"
import { UserInvitationsEmpty } from "./user-invitations-empty"

export type UserInvitationsProps = {
  className?: string
  onInvitationAction?: () => unknown | Promise<unknown>
}

/**
 * Organization invitations for the signed-in user. Always renders the section
 * card; uses `UserInvitationsEmpty` when there are no pending invitations.
 */
export function UserInvitations({ className, onInvitationAction }: UserInvitationsProps) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)
  const session = useSession(authClient)
  const emailVerified = session.data?.user.emailVerified === true

  const { data: invitations, isPending } = useListUserInvitations(authClient, {
    enabled: emailVerified,
  })

  return (
    <div className={className}>
      <div className="flex flex-col gap-3">
        <h2 className="truncate text-sm font-semibold">
          {organizationLocalization.invitations}
        </h2>

        <Card className="p-0">
          <CardContent className="p-0">
            {session.isPending || (emailVerified && isPending)
              ? (
                <ItemGroup>
                  <UserInvitationRowSkeleton />
                </ItemGroup>
              )
              : !invitations?.length
              ? <UserInvitationsEmpty verificationRequired={!emailVerified} />
              : (
                <ItemGroup className="gap-0">
                  {invitations.map((invitation, index) => (
                    <Fragment key={invitation.id}>
                      {index > 0 && <ItemSeparator />}
                      <UserInvitationRow
                        invitation={invitation}
                        {...onInvitationAction ? { onInvitationAction } : {}}
                      />
                    </Fragment>
                  ))}
                </ItemGroup>
              )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
