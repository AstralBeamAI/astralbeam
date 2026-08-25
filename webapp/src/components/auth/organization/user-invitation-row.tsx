// Added with: deno task ui add @better-auth-ui/organization
// Local changes: render Better Auth's comma-joined static roles as separate labels, add an icon-action hover title, and notify onboarding after an invitation action.

"use client"

import {
  memberRoleLabels,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import {
  useAcceptInvitation,
  useRejectInvitation,
} from "@better-auth-ui/react/plugins/organization"
import type { Invitation } from "better-auth/client"
import { CheckIcon as Check, ClockIcon as Clock, XIcon as X } from "@phosphor-icons/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"

export type UserInvitationRowProps = {
  invitation: Invitation & { organizationName?: string }
  onInvitationAction?: () => unknown | Promise<unknown>
}

/**
 * Single invitation row with accept/reject actions for the current user.
 */
export function UserInvitationRow({ invitation, onInvitationAction }: UserInvitationRowProps) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization, roles } = useAuthPlugin(organizationPlugin)

  const { mutate: acceptInvitation, isPending: isAccepting } = useAcceptInvitation(authClient, {
    onSuccess: () => onInvitationAction?.(),
  })

  const { mutate: rejectInvitation, isPending: isRejecting } = useRejectInvitation(authClient, {
    onSuccess: () => onInvitationAction?.(),
  })

  return (
    <Item>
      <ItemMedia variant="icon">
        <Clock />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {invitation.organizationName}
          <Badge variant="secondary">
            {memberRoleLabels(invitation.role, roles).join(", ")}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {new Date(invitation.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          disabled={isAccepting || isRejecting}
          onClick={() => acceptInvitation({ invitationId: invitation.id })}
        >
          {isAccepting ? <Spinner /> : <Check />}

          {organizationLocalization.accept}
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="size-8 text-destructive"
          disabled={isAccepting || isRejecting}
          onClick={() => rejectInvitation({ invitationId: invitation.id })}
          aria-label={organizationLocalization.rejectInvitation}
          title={organizationLocalization.rejectInvitation}
        >
          {isRejecting ? <Spinner /> : <X />}
        </Button>
      </ItemActions>
    </Item>
  )
}
