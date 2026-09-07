// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Use Phosphor icons, hover titles for icon-only actions, and static roles; take member permissions as props from the page loader; omit dynamic roles, teams, and member model fields.

import {
  hasMemberRole,
  memberRoleLabels,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import type { Member, Organization, User } from "better-auth/client"
import {
  PencilSimpleIcon as Pencil,
  SignOutIcon as LogOut,
  TrashIcon as Trash2,
} from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { UserView } from "../user/user-view"
import { EditMemberRolesDialog } from "./edit-member-roles-dialog"
import { LeaveOrganizationDialog } from "./leave-organization-dialog"
import { RemoveMemberDialog } from "./remove-member-dialog"

export type OrganizationMemberRowProps = {
  member: Member & { user: Partial<User> }
  isOwner?: boolean
  ownerCount?: number | undefined
  organization: Pick<Organization, "id" | "name" | "slug">
  canUpdateMember: boolean
  canRemoveMember: boolean
}

export function OrganizationMemberRow({
  member,
  isOwner,
  ownerCount,
  organization,
  canUpdateMember,
  canRemoveMember,
}: OrganizationMemberRowProps) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const {
    creatorRole,
    localization: organizationLocalization,
    roles,
  } = useAuthPlugin(organizationPlugin)

  const { data: session } = useSession(authClient)

  const roleLabel = memberRoleLabels(member.role, roles).join(", ")

  const assignableRoles = Object.entries(roles).filter(
    ([key]) => isOwner || key !== creatorRole,
  )

  const isCurrentUser = session?.user.id === member.userId
  const targetIsOwner = hasMemberRole(member.role, creatorRole)
  const canManageTarget = isOwner || !targetIsOwner
  const onlyOwnerActionDisabled = targetIsOwner &&
    (ownerCount === undefined || ownerCount <= 1)

  const [removeOpen, setRemoveOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [roleEditorOpen, setRoleEditorOpen] = useState(false)

  return (
    <TableRow>
      <TableCell>
        <UserView user={member.user} />
      </TableCell>

      <TableCell>{roleLabel}</TableCell>

      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {canManageTarget && canUpdateMember && (
            <Button
              aria-label={organizationLocalization.changeMemberRole}
              title={organizationLocalization.changeMemberRole}
              className="size-8"
              onClick={() => setRoleEditorOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Pencil />
            </Button>
          )}

          {canManageTarget && canUpdateMember && (
            <EditMemberRolesDialog
              member={member}
              onOpenChange={setRoleEditorOpen}
              open={roleEditorOpen}
              organizationId={organization.id}
              protectedRole={creatorRole}
              protectedRoleRemovalDisabled={onlyOwnerActionDisabled}
              roles={assignableRoles}
            />
          )}

          {isCurrentUser
            ? (
              <Button
                size="icon"
                variant="outline"
                className="size-8 text-destructive"
                aria-label={organizationLocalization.leaveOrganization}
                disabled={onlyOwnerActionDisabled}
                title={onlyOwnerActionDisabled
                  ? organizationLocalization.onlyOwnerActionDisabled
                  : organizationLocalization.leaveOrganization}
                onClick={() => setLeaveOpen(true)}
              >
                <LogOut />
              </Button>
            )
            : canManageTarget && canRemoveMember
            ? (
              <Button
                size="icon"
                variant="outline"
                className="size-8 text-destructive"
                aria-label={organizationLocalization.removeMember}
                disabled={onlyOwnerActionDisabled}
                title={onlyOwnerActionDisabled
                  ? organizationLocalization.onlyOwnerActionDisabled
                  : organizationLocalization.removeMember}
                onClick={() => setRemoveOpen(true)}
              >
                <Trash2 />
              </Button>
            )
            : null}
        </div>

        {isCurrentUser && organization && !onlyOwnerActionDisabled
          ? (
            <LeaveOrganizationDialog
              open={leaveOpen}
              onOpenChange={setLeaveOpen}
              organization={organization}
            />
          )
          : (
            canManageTarget &&
            canRemoveMember &&
            !onlyOwnerActionDisabled && (
              <RemoveMemberDialog
                open={removeOpen}
                onOpenChange={setRemoveOpen}
                member={member}
              />
            )
          )}
      </TableCell>
    </TableRow>
  )
}
