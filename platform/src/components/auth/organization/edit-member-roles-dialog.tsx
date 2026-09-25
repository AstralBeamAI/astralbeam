// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Use Phosphor icons, Base UI Toast, domain-specific function names, and a single-role select with last-owner protection, and reset the selection during render when the dialog opens.

"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useUpdateMemberRole } from "@better-auth-ui/react/plugins/organization"
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { useState } from "react"

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
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { organizationPlugin } from "@/lib/auth/organization-plugin"

export type EditMemberRolesDialogProps = {
  member: {
    id: string
    role?: string | null
  }
  onOpenChange: (open: boolean) => void
  open: boolean
  organizationId: string
  roles: Array<[string, string]>
  protectedRole?: string
  protectedRoleRemovalDisabled?: boolean
}

export function EditMemberRolesDialog({
  member,
  onOpenChange,
  open,
  organizationId,
  roles,
  protectedRole,
  protectedRoleRemovalDisabled,
}: EditMemberRolesDialogProps) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)
  const initialRole = roles.find(([role]) => role === member.role)?.[0] ?? null
  const [selectedRole, setSelectedRole] = useState(initialRole)
  const { mutate: updateMemberRole, isPending } = useUpdateMemberRole(authClient, {
    onSuccess: () => {
      toast.add({ title: organizationLocalization.memberRoleUpdated, type: "success" })
      onOpenChange(false)
    },
  })

  const [prevOpen, setPrevOpen] = useState(open)
  const [prevMemberRole, setPrevMemberRole] = useState(member.role)
  if (open !== prevOpen || member.role !== prevMemberRole) {
    setPrevOpen(open)
    setPrevMemberRole(member.role)
    if (open) setSelectedRole(initialRole)
  }

  const isRoleValid =
    roles.some(([role]) => role === selectedRole) &&
    (!protectedRoleRemovalDisabled || selectedRole === protectedRole)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selectedRole || !isRoleValid) return

            updateMemberRole({
              memberId: member.id,
              organizationId,
              role: selectedRole,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck />
              {organizationLocalization.changeMemberRole}
            </DialogTitle>
            <DialogDescription>
              {organizationLocalization.changeMemberRoleDescription}
            </DialogDescription>
          </DialogHeader>

          <Field>
            <FieldLabel htmlFor={`member-${member.id}-role`}>
              {organizationLocalization.role}
            </FieldLabel>
            <Select
              items={roles.map(([value, label]) => ({ value, label }))}
              value={selectedRole}
              onValueChange={setSelectedRole}
              disabled={isPending}
            >
              <SelectTrigger id={`member-${member.id}-role`} className="w-full">
                <SelectValue placeholder={organizationLocalization.selectRoles} />
              </SelectTrigger>
              <SelectContent>
                {roles.map(([role, label]) => (
                  <SelectItem
                    key={role}
                    value={role}
                    disabled={protectedRoleRemovalDisabled && role !== protectedRole}
                  >
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isPending}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>
            <Button disabled={isPending || !isRoleValid} type="submit">
              {isPending && <Spinner />}
              {localization.settings.saveChanges}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
