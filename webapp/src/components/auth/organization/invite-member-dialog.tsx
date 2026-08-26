// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor/Base Toast, domain-specific function names, and composable static roles; omit disabled teams, dynamic roles, and invitation model fields.

"use client"

import {
  hasMemberRole,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import {
  useActiveMemberRole,
  useActiveOrganization,
  useHasPermission,
  useInviteMember,
  useListOrganizationInvitations,
} from "@better-auth-ui/react/plugins/organization"
import { CaretDownIcon as ChevronDown, UserPlusIcon as UserPlus } from "@phosphor-icons/react"
import { type SyntheticEvent, useEffect, useMemo, useState } from "react"
import { toast } from "@/components/ui/toast"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "@/lib/utils"

/** Props for the `InviteMemberDialog` component. */
export type InviteMemberDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const pickDefaultRole = (keys: string[]) => keys.includes("viewer") ? "viewer" : (keys.at(-1) ?? "")

/**
 * Render a dialog for inviting a member to the organization.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
}: InviteMemberDialogProps) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const {
    creatorRole,
    invitationLimit,
    localization: organizationLocalization,
    roles,
  } = useAuthPlugin(organizationPlugin)
  const { data: activeOrganization } = useActiveOrganization(authClient)
  const { data: activeMemberRole } = useActiveMemberRole(authClient)
  const invitations = useListOrganizationInvitations(authClient)
  const canInvite = useHasPermission(authClient, {
    organizationId: activeOrganization?.id,
    permissions: { invitation: ["create"] },
  })
  const isOwner = hasMemberRole(activeMemberRole?.role, creatorRole)
  const assignableRoles = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(roles).filter(([role]) => isOwner || role !== creatorRole),
      ),
    [creatorRole, isOwner, roles],
  )

  const [selectedRoles, setSelectedRoles] = useState(() => {
    const fallback = pickDefaultRole(Object.keys(assignableRoles))
    return fallback ? [fallback] : []
  })
  const [emailError, setEmailError] = useState<string>()
  const activeOrganizationId = activeOrganization?.id
  const roleItems = Object.entries(assignableRoles).map(([value, label]) => ({
    label,
    value,
  }))

  useEffect(() => {
    setSelectedRoles((current) => {
      const keys = Object.keys(assignableRoles)
      const kept = current.filter((entry) => keys.includes(entry))

      if (kept.length > 0) return kept

      const fallback = pickDefaultRole(keys)
      return fallback ? [fallback] : []
    })
  }, [assignableRoles])

  useEffect(() => {
    if (!open) setEmailError(undefined)
  }, [open])

  const { mutate: inviteMember, isPending: isInviting } = useInviteMember(
    authClient,
    {
      onSuccess: () => {
        onOpenChange(false)
        toast.add({ title: organizationLocalization.inviteMemberSuccess, type: "success" })
      },
    },
  )

  const isRoleValid = selectedRoles.length > 0

  const roleSummary = selectedRoles
    .map((entry) => assignableRoles[entry] ?? entry)
    .join(", ")

  const toggleInvitationRole = (role: string) => {
    setSelectedRoles((current) =>
      current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role]
    )
  }

  const submitMemberInvitation = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (
      !activeOrganizationId ||
      !canInvite.data?.success ||
      !isRoleValid ||
      atInvitationLimit
    ) {
      return
    }

    const formData = new FormData(e.currentTarget)
    const invitationEmail = (formData.get("email") as string).trim()
    const invitationRoles = [...selectedRoles] as Parameters<
      typeof inviteMember
    >[0]["role"]

    inviteMember(
      {
        email: invitationEmail,
        organizationId: activeOrganizationId,
        role: invitationRoles,
      },
    )
  }

  const atInvitationLimit = invitationLimit !== undefined &&
    (invitations.data?.filter((invitation) => invitation.status === "pending")
        .length ?? 0) >= invitationLimit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submitMemberInvitation} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus />
              {organizationLocalization.inviteMember}
            </DialogTitle>

            <DialogDescription>
              {organizationLocalization.inviteMemberDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="invite-member-email">
                {localization.auth.email}
              </FieldLabel>

              <Input
                id="invite-member-email"
                name="email"
                type="email"
                autoFocus
                required
                placeholder={localization.auth.email}
                disabled={isInviting}
                onChange={() => setEmailError(undefined)}
                onInvalid={(e) => {
                  e.preventDefault()
                  const el = e.target as HTMLInputElement
                  const msg = el.validity.valueMissing
                    ? localization.auth.fieldRequired
                    : localization.auth.invalidEmail
                  setEmailError(msg)
                }}
                aria-invalid={!!emailError}
              />

              <FieldError>{emailError}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-member-role">
                {organizationLocalization.role}
              </FieldLabel>

              <DropdownMenu>
                <DropdownMenuTrigger
                  id="invite-member-role"
                  disabled={isInviting}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-between font-normal",
                  )}
                >
                  <span className={cn(!roleSummary && "text-muted-foreground")}>
                    {roleSummary || organizationLocalization.selectRoles}
                  </span>
                  <ChevronDown className="opacity-50" />
                </DropdownMenuTrigger>

                <DropdownMenuContent align="start">
                  {roleItems.map((item) => {
                    const checked = selectedRoles.includes(item.value)

                    return (
                      <DropdownMenuCheckboxItem
                        key={item.value}
                        checked={checked}
                        disabled={checked && selectedRoles.length === 1}
                        onCheckedChange={() => toggleInvitationRole(item.value)}
                      >
                        {item.label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <FieldError />
            </Field>
          </div>

          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isInviting}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>

            <Button
              type="submit"
              disabled={isInviting ||
                !isRoleValid ||
                atInvitationLimit ||
                canInvite.isPending ||
                !canInvite.data?.success}
            >
              {isInviting && <Spinner />}

              {organizationLocalization.inviteMember}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
