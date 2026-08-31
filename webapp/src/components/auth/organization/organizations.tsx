// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Replace Lucide with Phosphor icons, activate organizations before managing them, and colocate private row and empty states.
"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import {
  useListOrganizations,
  useSetActiveOrganization,
} from "@better-auth-ui/react/plugins/organization"
import { BriefcaseIcon as Briefcase, GearIcon as SettingsIcon } from "@phosphor-icons/react"
import type { Organization } from "better-auth/client"
import { Fragment, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemActions, ItemGroup, ItemSeparator } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { CreateOrganizationDialog } from "./create-organization-dialog"
import { OrganizationViewSkeleton } from "./organization-view-skeleton"
import { OrganizationView } from "./organization-view"

export type OrganizationsProps = {
  className?: string
}

/**
 * Lists organizations the user belongs to (via `useListOrganizations`): loading skeleton,
 * empty state with create, or a card of rows with a Manage control per organization.
 * Owns `CreateOrganizationDialog` open state and the create actions.
 */
export function Organizations({ className }: OrganizationsProps) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const {
    allowOrganizationCreation,
    localization: organizationLocalization,
    organizationLimit,
  } = useAuthPlugin(organizationPlugin)

  const [createOpen, setCreateOpen] = useState(false)

  const { data: organizations, isPending: organizationsPending } = useListOrganizations(authClient)
  const canCreate = allowOrganizationCreation &&
    (organizationLimit === undefined ||
      (organizations?.length ?? 0) < organizationLimit)

  return (
    <>
      <div className={className}>
        <div className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="truncate text-sm font-semibold">
              {organizationLocalization.organizations}
            </h2>

            {allowOrganizationCreation && (
              <Button
                className="shrink-0"
                size="sm"
                disabled={organizationsPending || !canCreate}
                onClick={() => setCreateOpen(true)}
              >
                {organizationLocalization.createOrganization}
              </Button>
            )}
          </div>

          <Card className="p-0">
            <CardContent className="p-0">
              {organizationsPending
                ? (
                  <ItemGroup>
                    <Item>
                      <OrganizationViewSkeleton />
                    </Item>
                  </ItemGroup>
                )
                : !organizations?.length
                ? (
                  <OrganizationsEmpty
                    canCreate={canCreate}
                    onCreatePress={() => setCreateOpen(true)}
                  />
                )
                : (
                  <ItemGroup className="gap-0">
                    {organizations.map((organization, index) => (
                      <Fragment key={organization.id}>
                        {index > 0 && <ItemSeparator />}
                        <OrganizationRow organization={organization} />
                      </Fragment>
                    ))}
                  </ItemGroup>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      {canCreate && (
        <CreateOrganizationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </>
  )
}

function OrganizationsEmpty({
  onCreatePress,
  canCreate = true,
}: {
  onCreatePress: () => void
  canCreate?: boolean
}) {
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Briefcase />
        </EmptyMedia>
        <EmptyTitle>{organizationLocalization.noOrganizations}</EmptyTitle>
        <EmptyDescription>
          {organizationLocalization.organizationsDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" disabled={!canCreate} onClick={onCreatePress}>
          {organizationLocalization.createOrganization}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function OrganizationRow({ organization }: { organization: Organization }) {
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
