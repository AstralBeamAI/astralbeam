// Added with: deno task ui add @better-auth-ui/organization
// Local changes: Replace Lucide with Phosphor icons, add a stable accessible trigger name and hover title, address organizations by their root-level slug path, and let a URL-scoped page supply the active organization.

"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import {
  useActiveOrganization,
  useListOrganizations,
} from "@better-auth-ui/react/plugins/organization"
import type { Organization } from "better-auth/client"
import {
  CaretUpDownIcon as ChevronsUpDown,
  GearIcon as SettingsIcon,
  PlusCircleIcon as PlusCircle,
} from "@phosphor-icons/react"
import { type ComponentProps, type ReactElement, useState } from "react"

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "cn"
import { UserView } from "../user/user-view"
import { CreateOrganizationDialog } from "./create-organization-dialog"
import { OrganizationView } from "./organization-view"

/** Props for the `OrganizationSwitcher` component. */
export type OrganizationSwitcherProps = {
  className?: string
  align?: "center" | "end" | "start"
  side?: "top" | "right" | "bottom" | "left"
  sideOffset?: number
  trigger?: ReactElement<ComponentProps<typeof DropdownMenuTrigger>>
  hideCreate?: boolean
  hidePersonal?: boolean
  hideSettings?: boolean
  hideSlug?: boolean
  setActive?: (organization: Organization | null) => void
  onOrganizationCreated?: (organization: Organization) => unknown
  /** The organization the URL addresses, which the session's own active organization follows. */
  organization?: Pick<Organization, "id" | "name" | "slug"> | undefined
}

/**
 * Renders an organizations dropdown with a trigger button,
 * header summary, and a menu of organizations to switch to.
 */
export function OrganizationSwitcher({
  className,
  align,
  side,
  sideOffset,
  hideCreate,
  hidePersonal,
  hideSettings,
  hideSlug = true,
  setActive,
  onOrganizationCreated,
  organization: routeOrganization,
  trigger,
}: OrganizationSwitcherProps) {
  const { authClient, navigate, basePaths, localization, viewPaths, Link } = useAuth<
    OrganizationAuthClient
  >()
  const { data: session, isPending: sessionPending } = useSession(authClient)
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  const { data: sessionOrganization, isPending: sessionOrganizationPending } =
    useActiveOrganization(authClient, { enabled: !routeOrganization })
  const activeOrganization = routeOrganization ?? sessionOrganization

  const { data: organizations, isPending: organizationsPending } = useListOrganizations(authClient)

  const isPending = sessionPending ||
    (!!session && (organizationsPending || (!routeOrganization && sessionOrganizationPending)))

  const [createOpen, setCreateOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const otherOrganizations = organizations?.filter(
    (organization) => organization.id !== activeOrganization?.id,
  ) ?? []

  const hasOtherEntries = otherOrganizations.length > 0 || (!!activeOrganization && !hidePersonal)

  function handleSetActive(organization: Organization | null) {
    setDropdownOpen(false)

    if (setActive) {
      setActive(organization)
    } else if (organization) {
      navigate({ to: `/${organization.slug}` })
    } else {
      navigate({ to: `${basePaths.settings}/${viewPaths.settings.account}` })
    }
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        {trigger ?? (
          <DropdownMenuTrigger
            aria-label={activeOrganization?.name ?? organizationLocalization.organization}
            title={activeOrganization?.name ?? organizationLocalization.organization}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-auto px-2 py-2 text-start",
              className,
            )}
            disabled={!session || isPending}
          >
            {isPending
              ? <OrganizationView isPending hideRole hideSlug={hideSlug} />
              : activeOrganization
              ? (
                <OrganizationView
                  hideRole
                  hideSlug={hideSlug}
                  organization={activeOrganization}
                />
              )
              : session && !hidePersonal
              ? <UserView hideSubtitle={hideSlug} />
              : (
                <OrganizationView
                  hideRole
                  hideSlug={hideSlug}
                  organization={{ name: organizationLocalization.organization }}
                />
              )}

            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent
          align={align}
          side={side}
          sideOffset={sideOffset}
          className="min-w-64 max-w-svw"
        >
          {activeOrganization
            ? (
              <div className="flex items-center justify-between gap-4 px-2 py-2">
                <OrganizationView
                  hideRole
                  hideSlug={hideSlug}
                  organization={activeOrganization}
                />

                {!hideSettings && (
                  <Link
                    href={`/${activeOrganization.slug}/settings`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                  >
                    <SettingsIcon className="text-muted-foreground" />

                    {organizationLocalization.manage}
                  </Link>
                )}
              </div>
            )
            : !isPending && session?.user && !hidePersonal
            ? (
              <div className="flex items-center justify-between gap-4 px-2 py-2">
                <UserView hideSubtitle={hideSlug} />

                {!hideSettings && (
                  <Link
                    href={`${basePaths.settings}/${viewPaths.settings.account}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                  >
                    <SettingsIcon className="text-muted-foreground" />

                    {localization.settings.settings}
                  </Link>
                )}
              </div>
            )
            : null}

          <DropdownMenuSeparator />

          {!!activeOrganization && !hidePersonal && (
            <DropdownMenuItem onClick={() => handleSetActive(null)}>
              <UserView hideSubtitle={hideSlug} />
            </DropdownMenuItem>
          )}

          {otherOrganizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onClick={() => handleSetActive(organization)}
            >
              <OrganizationView
                hideRole
                hideSlug={hideSlug}
                organization={organization}
              />
            </DropdownMenuItem>
          ))}

          {!hideCreate && (
            <>
              {hasOtherEntries && <DropdownMenuSeparator />}

              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false)
                  setCreateOpen(true)
                }}
              >
                <PlusCircle className="text-muted-foreground" />

                {organizationLocalization.createOrganization}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOrganizationCreated={onOrganizationCreated}
      />
    </>
  )
}
