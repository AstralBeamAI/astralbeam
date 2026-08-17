// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Restricts the upstream switcher to SaaS organizations, accepts a typed organization client, uses Phosphor icons, and notifies consumers after organization changes.

"use client"

import {
  type OrganizationAuthClient,
  useActiveOrganization,
  useAuthPlugin,
  useListOrganizations,
  useSession,
  useSetActiveOrganization,
} from "@better-auth-ui/react"
import { CaretUpDownIcon, PlusCircleIcon } from "@phosphor-icons/react"
import type { Organization } from "better-auth/client"
import { type ComponentProps, type ReactElement, useState } from "react"

import { buttonVariants } from "@/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "@/lib/utils"
import { CreateOrganizationDialog } from "./create-organization-dialog"
import { OrganizationView } from "./organization-view"

export type OrganizationSwitcherProps = {
  authClient: OrganizationAuthClient
  align?: "center" | "end" | "start" | undefined
  className?: string | undefined
  hideCreate?: boolean | undefined
  hideSlug?: boolean | undefined
  onActiveChange?: (() => void | Promise<void>) | undefined
  side?: "top" | "right" | "bottom" | "left" | undefined
  sideOffset?: number | undefined
  trigger?: ReactElement<ComponentProps<typeof DropdownMenuTrigger>> | undefined
}

/** Renders the upstream Better Auth UI organization switcher without a personal account option. */
export function OrganizationSwitcher({
  authClient,
  align,
  className,
  hideCreate,
  hideSlug = true,
  onActiveChange,
  side,
  sideOffset,
  trigger,
}: OrganizationSwitcherProps) {
  const { localization } = useAuthPlugin(organizationPlugin)
  const { data: session, isPending: sessionPending } = useSession(authClient)
  const { data: activeOrganization, isPending: activeOrganizationPending } =
    useActiveOrganization(authClient)
  const { data: organizations, isPending: organizationsPending } = useListOrganizations(authClient)
  const setActiveOptions = onActiveChange ? { onSuccess: onActiveChange } : {}
  const { mutate: setActiveOrganization } = useSetActiveOrganization(authClient, setActiveOptions)

  const [createOpen, setCreateOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const isPending =
    sessionPending || (!!session && (organizationsPending || activeOrganizationPending))
  const otherOrganizations =
    organizations?.filter((organization) => organization.id !== activeOrganization?.id) ?? []

  function handleSetActive(organization: Organization) {
    setDropdownOpen(false)
    setActiveOrganization({ organizationId: organization.id })
  }

  function handleCreate() {
    setDropdownOpen(false)
    setCreateOpen(true)
  }

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        {trigger ?? (
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-auto px-2 py-2 text-start",
              className,
            )}
            disabled={!session || isPending}
          >
            <OrganizationView
              hideSlug={hideSlug}
              isPending={isPending}
              organization={activeOrganization ?? { name: localization.organization }}
            />
            <CaretUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent
          align={align}
          className="min-w-64 max-w-svw"
          side={side}
          sideOffset={sideOffset}
        >
          {activeOrganization && (
            <div className="px-2 py-2">
              <OrganizationView hideSlug={hideSlug} organization={activeOrganization} />
            </div>
          )}

          {activeOrganization && (otherOrganizations.length > 0 || !hideCreate) && (
            <DropdownMenuSeparator />
          )}

          {otherOrganizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onClick={() => handleSetActive(organization)}>
              <OrganizationView hideSlug={hideSlug} organization={organization} />
            </DropdownMenuItem>
          ))}

          {!hideCreate && (
            <DropdownMenuItem onClick={handleCreate}>
              <PlusCircleIcon className="text-muted-foreground" />
              {localization.createOrganization}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrganizationDialog
        authClient={authClient}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={onActiveChange}
      />
    </>
  )
}
