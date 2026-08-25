// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Replace Lucide with Phosphor icons and make Manage activate the organization before opening the approved members page.

"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useSetActiveOrganization } from "@better-auth-ui/react/plugins/organization"
import type { Organization } from "better-auth/client"
import { GearIcon as SettingsIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Item, ItemActions } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { OrganizationView } from "./organization-view"

export type OrganizationRowProps = {
  organization: Organization
}

/**
 * Single organization row: logo and labels via `OrganizationView`, plus a Manage action.
 */
export function OrganizationRow({ organization }: OrganizationRowProps) {
  const { authClient, basePaths, navigate } = useAuth<OrganizationAuthClient>()
  const {
    localization: organizationLocalization,
    viewPaths: organizationViewPaths,
  } = useAuthPlugin(organizationPlugin)

  const { mutate: setActiveOrganization, isPending: setActivePending } = useSetActiveOrganization(
    authClient,
    {
      onSuccess: () => {
        navigate({
          to: `${basePaths.organization}/${organizationViewPaths.organization.people}`,
        })
      },
    },
  )

  function manageOrganization() {
    setActiveOrganization({ organizationId: organization.id })
  }

  return (
    <Item>
      <OrganizationView className="flex-1" organization={organization} />
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          disabled={setActivePending}
          onClick={manageOrganization}
          aria-label={organizationLocalization.manage}
        >
          {setActivePending ? <Spinner /> : <SettingsIcon />}

          {organizationLocalization.manage}
        </Button>
      </ItemActions>
    </Item>
  )
}
