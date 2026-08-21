import { Link, useLocation } from "@tanstack/react-router"
import {
  Buildings as Building2,
  Gear as Settings,
  ShieldCheck,
  SquaresFour as LayoutDashboard,
  Users,
} from "@phosphor-icons/react"
import type { ReactElement } from "react"

import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher"
import { UserButton } from "@/components/auth/user/user-button"
import { UserView } from "@/components/auth/user/user-view"
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

const workspaceNavigation = [
  {
    icon: LayoutDashboard,
    label: "Dashboard",
    pathname: "/dashboard",
    link: <Link to="/dashboard" />,
  },
  {
    icon: Users,
    label: "People",
    pathname: "/organization/people",
    link: <Link to="/organization/$path" params={{ path: "people" }} />,
  },
  {
    icon: Building2,
    label: "Organization",
    pathname: "/organization/settings",
    link: <Link to="/organization/$path" params={{ path: "settings" }} />,
  },
] as const

const accountNavigation = [
  {
    icon: Settings,
    label: "Account",
    pathname: "/settings/account",
    link: <Link to="/settings/$path" params={{ path: "account" }} />,
  },
  {
    icon: ShieldCheck,
    label: "Security",
    pathname: "/settings/security",
    link: <Link to="/settings/$path" params={{ path: "security" }} />,
  },
] as const

export function AppSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border">
        <Link className="flex h-9 items-center gap-2 px-2" to="/dashboard">
          <img
            alt="AstralBeam"
            className="hidden size-7 shrink-0 group-data-[collapsible=icon]:block"
            src="/astralbeam-logo-light.svg"
          />
          <img
            alt="AstralBeam"
            className="h-6 w-auto group-data-[collapsible=icon]:hidden"
            src="/astralbeam-wordmark-light.svg"
          />
        </Link>
        <OrganizationSwitcher
          className="w-full group-data-[collapsible=icon]:hidden"
          hidePersonal
        />
      </SidebarHeader>

      <SidebarContent>
        <NavigationGroup label="Workspace" pathname={pathname} items={workspaceNavigation} />
        <NavigationGroup label="Your account" pathname={pathname} items={accountNavigation} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <UserView />
          </div>
          <UserButton className="shrink-0" size="icon" />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function NavigationGroup({
  items,
  label,
  pathname,
}: {
  items: ReadonlyArray<{
    icon: typeof LayoutDashboard
    link: ReactElement
    label: string
    pathname: string
  }>
  label: string
  pathname: string
}) {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ icon: Icon, label: itemLabel, link, pathname: itemPathname }) => (
            <SidebarMenuItem key={itemPathname}>
              <SidebarMenuButton
                isActive={pathname === itemPathname}
                onClick={() => setOpenMobile(false)}
                render={link}
                tooltip={itemLabel}
              >
                <Icon />
                <span>{itemLabel}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
