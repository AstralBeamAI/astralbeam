// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Replace Lucide with Phosphor icons and Sonner with Base UI Toast.

"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useLeaveOrganization } from "@better-auth-ui/react/plugins/organization"
import type { Organization } from "better-auth/client"
import { SignOutIcon as LogOut } from "@phosphor-icons/react"
import { toast } from "@/components/ui/toast"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { OrganizationView } from "./organization-view"

export type LeaveOrganizationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  organization: Organization
}

export function LeaveOrganizationDialog({
  open,
  onOpenChange,
  organization,
}: LeaveOrganizationDialogProps) {
  const { authClient, basePaths, localization, navigate } = useAuth<OrganizationAuthClient>()
  const {
    localization: organizationLocalization,
    viewPaths: organizationPluginViewPaths,
  } = useAuthPlugin(organizationPlugin)

  const { mutate: leaveOrganization, isPending } = useLeaveOrganization(
    authClient,
    {
      onSuccess: () => {
        onOpenChange(false)
        toast.add({ title: organizationLocalization.leftOrganization, type: "success" })

        navigate({
          to: `${basePaths.settings}/${organizationPluginViewPaths.settings.organizations}`,
          replace: true,
        })
      },
    },
  )

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <LogOut />
          </AlertDialogMedia>

          <AlertDialogTitle>
            {organizationLocalization.leaveOrganization}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {organizationLocalization.leaveOrganizationDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Card>
          <CardContent>
            <OrganizationView organization={organization} hideRole />
          </CardContent>
        </Card>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {localization.settings.cancel}
          </AlertDialogCancel>

          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => leaveOrganization({ organizationId: organization.id })}
          >
            {isPending && <Spinner />}

            {organizationLocalization.leaveOrganization}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
