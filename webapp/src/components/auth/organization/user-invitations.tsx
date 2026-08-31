// Added with: deno task ui add @better-auth-ui/organization
// Local changes: expose an invitation-action callback so onboarding can refresh organization access, replace Lucide with Phosphor icons, and colocate private list states.
import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import { useListUserInvitations } from "@better-auth-ui/react/plugins/organization"
import { PaperPlaneTiltIcon as Send, WarningCircleIcon as MailWarning } from "@phosphor-icons/react"
import { Fragment } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemContent, ItemGroup, ItemMedia, ItemSeparator } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { UserInvitationRow } from "./user-invitation-row"

export type UserInvitationsProps = {
  className?: string
  onInvitationAction?: () => unknown
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

function UserInvitationRowSkeleton() {
  return (
    <Item>
      <ItemMedia>
        <Skeleton className="size-10 shrink-0 rounded-md" />
      </ItemMedia>
      <ItemContent>
        <Skeleton className="h-4 w-40 rounded-md" />
        <Skeleton className="h-3 w-28 rounded-md" />
      </ItemContent>
    </Item>
  )
}

function UserInvitationsEmpty({
  verificationRequired = false,
}: {
  verificationRequired?: boolean
}) {
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {verificationRequired ? <MailWarning /> : <Send />}
        </EmptyMedia>
        <EmptyTitle>
          {verificationRequired
            ? organizationLocalization.verifyEmailToViewInvitations
            : organizationLocalization.noInvitations}
        </EmptyTitle>
        <EmptyDescription>
          {verificationRequired
            ? organizationLocalization.verifyEmailToViewInvitationsDescription
            : organizationLocalization.userInvitationsEmptyDescription}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
