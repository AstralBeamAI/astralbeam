"use client"

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth } from "@better-auth-ui/react"
import { useSetActiveOrganization } from "@better-auth-ui/react/plugins/organization"
import {
  HouseIcon,
  type Icon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { useRouterState } from "@tanstack/react-router"
import type { Organization } from "better-auth/client"
import { type ComponentProps, useEffect } from "react"

import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher"
import { UserButton } from "@/components/auth/user/user-button"
// Load the Better Auth UI Link module augmentation used by useAuth().
import type {} from "@/components/auth/auth-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

const organizationNavigation = [
  { label: "Dashboard", href: "/", icon: HouseIcon },
  {
    label: "Members",
    href: "/organization/members",
    icon: UsersThreeIcon,
  },
] satisfies ReadonlyArray<{
  label: string
  href: string
  icon: Icon
}>

export type AppSidebarProps =
  & Omit<
    ComponentProps<typeof Sidebar>,
    "children"
  >
  & {
    onOrganizationChange?: (phase: "error" | "start" | "success") => unknown | Promise<unknown>
  }

export function AppSidebar({
  onOrganizationChange,
  ...props
}: AppSidebarProps) {
  const { authClient, Link, localization } = useAuth<OrganizationAuthClient>()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  const { mutate: setActiveOrganization } = useSetActiveOrganization(
    authClient,
    {
      onSuccess: () => {
        setOpenMobile(false)
        return onOrganizationChange?.("success")
      },
      onError: () => onOrganizationChange?.("error"),
    },
  )

  const handleOrganizationChange = (organization: Organization | null) => {
    onOrganizationChange?.("start")
    setActiveOrganization({ organizationId: organization?.id ?? null })
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher
          align="start"
          side="right"
          hidePersonal
          hideSettings
          setActive={handleOrganizationChange}
          onOrganizationCreated={() => {
            onOrganizationChange?.("start")
            return onOrganizationChange?.("success")
          }}
          className="w-full justify-start group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>div>div]:hidden group-data-[collapsible=icon]:[&>svg]:hidden"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Organization</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Organization navigation">
              <SidebarMenu>
                {organizationNavigation.map((item) => {
                  const isActive = pathname === item.href

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={
                          <Link
                            href={item.href}
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                        isActive={isActive}
                        tooltip={item.label}
                        {...(isActive ? { "aria-current": "page" } : {})}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserButton
          align="start"
          hideSettings
          links={[
            {
              href: "/settings/account",
              icon: <UserCircleIcon className="text-muted-foreground" />,
              label: localization.settings.account,
              visibility: "authenticated",
            },
            {
              href: "/settings/security",
              icon: <ShieldCheckIcon className="text-muted-foreground" />,
              label: localization.settings.security,
              visibility: "authenticated",
            },
          ]}
          className="w-full justify-start group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:[&>div>div]:hidden group-data-[collapsible=icon]:[&>svg]:hidden"
        />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
