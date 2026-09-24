// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor/Base Toast, domain-specific function names, and a single-role select; take the organization and creator role as props from the page loader and scope the invitation query to its ID; reveal the pending invitation when its email could not be delivered; omit disabled teams, dynamic roles, and invitation model fields; focus the email through the dialog's initialFocus and adjust role and error state during render.

"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import {
  useInviteMember,
  useListOrganizationInvitations,
} from "@better-auth-ui/react/plugins/organization"
import { UserPlusIcon as UserPlus } from "@phosphor-icons/react"
import { type SyntheticEvent, useMemo, useRef, useState } from "react"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { isAuthEmailDeliveryError } from "@/lib/auth/email-delivery"
import { organizationPlugin } from "@/lib/auth/organization-plugin"

/** Props for the `InviteMemberDialog` component. */
export type InviteMemberDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string
  isOwner: boolean
}

const pickDefaultRole = (keys: string[]) =>
  keys.includes("viewer") ? "viewer" : (keys.at(-1) ?? "")

/**
 * Render a dialog for inviting a member to the organization.
 */
export function InviteMemberDialog({
  open,
  onOpenChange,
  organizationId,
  isOwner,
}: InviteMemberDialogProps) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const {
    creatorRole,
    invitationLimit,
    localization: organizationLocalization,
    roles,
  } = useAuthPlugin(organizationPlugin)
  // Scoped to the prop, not the active organization, so the limit and the delivery-error refetch
  // both describe the organization this dialog is inviting into.
  const invitations = useListOrganizationInvitations(authClient, { query: { organizationId } })
  const assignableRoles = useMemo(
    () =>
      Object.fromEntries(Object.entries(roles).filter(([role]) => isOwner || role !== creatorRole)),
    [creatorRole, isOwner, roles],
  )

  const [selectedRole, setSelectedRole] = useState<string | null>(() =>
    pickDefaultRole(Object.keys(assignableRoles)),
  )
  const [emailError, setEmailError] = useState<string>()
  const roleItems = Object.entries(assignableRoles).map(([value, label]) => ({
    label,
    value,
  }))

  const emailInputRef = useRef<HTMLInputElement>(null)

  const [prevAssignableRoles, setPrevAssignableRoles] = useState(assignableRoles)
  if (assignableRoles !== prevAssignableRoles) {
    setPrevAssignableRoles(assignableRoles)
    setSelectedRole((current) => {
      const keys = Object.keys(assignableRoles)
      return current && keys.includes(current) ? current : pickDefaultRole(keys)
    })
  }

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setEmailError(undefined)
  }

  const { mutate: inviteMember, isPending: isInviting } = useInviteMember(authClient, {
    // Better Auth creates the invitation before it sends the email, so a delivery failure leaves
    // a pending invitation the list has not seen yet. Refetching surfaces its row, whose resend
    // control is the recovery path; ErrorToaster reports the failure itself.
    onError: (error) => {
      if (isAuthEmailDeliveryError(error)) void invitations.refetch()
    },
    onSuccess: () => {
      onOpenChange(false)
      toast.add({ title: organizationLocalization.inviteMemberSuccess, type: "success" })
    },
  })

  const isRoleValid = selectedRole !== null && Object.hasOwn(assignableRoles, selectedRole)

  const submitMemberInvitation = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!isRoleValid || atInvitationLimit) return

    const formData = new FormData(e.currentTarget)
    const invitationEmail = (formData.get("email") as string).trim()

    inviteMember({
      email: invitationEmail,
      organizationId,
      role: selectedRole,
    })
  }

  const atInvitationLimit =
    invitationLimit !== undefined &&
    (invitations.data?.filter((invitation) => invitation.status === "pending").length ?? 0) >=
      invitationLimit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={emailInputRef}>
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
              <FieldLabel htmlFor="invite-member-email">{localization.auth.email}</FieldLabel>

              <Input
                id="invite-member-email"
                name="email"
                type="email"
                ref={emailInputRef}
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
              <FieldLabel htmlFor="invite-member-role">{organizationLocalization.role}</FieldLabel>

              <Select
                items={roleItems}
                value={selectedRole}
                onValueChange={setSelectedRole}
                disabled={isInviting}
              >
                <SelectTrigger id="invite-member-role" className="w-full">
                  <SelectValue placeholder={organizationLocalization.selectRoles} />
                </SelectTrigger>
                <SelectContent>
                  {roleItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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

            <Button type="submit" disabled={isInviting || !isRoleValid || atInvitationLimit}>
              {isInviting && <Spinner />}

              {organizationLocalization.inviteMember}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
