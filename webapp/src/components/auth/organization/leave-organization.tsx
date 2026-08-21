import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import {
  useActiveOrganization,
  useListOrganizationMembers,
} from "@better-auth-ui/react/plugins/organization"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { isSoleOrganizationOwner } from "@/auth/organization-access-control"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { LeaveOrganizationDialog } from "./leave-organization-dialog"

/**
 * Danger-zone row to leave the active organization.
 */
export function LeaveOrganization() {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  const { data: activeOrganization } = useActiveOrganization(authClient)
  const { data: session } = useSession(authClient)
  const { data: membersData, isPending: membersPending } = useListOrganizationMembers(authClient)
  const isSoleOwner = isSoleOrganizationOwner(membersData?.members ?? [], session?.user.id)

  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium leading-tight">
          {organizationLocalization.leaveOrganization}
        </p>

        <p className="text-muted-foreground mt-0.5 text-xs">
          {isSoleOwner
            ? "Transfer ownership to another member before leaving this organization."
            : organizationLocalization.leaveOrganizationDescription}
        </p>
      </div>

      <Button
        disabled={!activeOrganization || membersPending || isSoleOwner}
        size="sm"
        variant="outline"
        className="text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        {organizationLocalization.leaveOrganization}
      </Button>

      {activeOrganization && (
        <LeaveOrganizationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          organization={activeOrganization}
        />
      )}
    </div>
  )
}
