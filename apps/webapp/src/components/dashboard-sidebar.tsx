import astralbeamLightWordmarkUrl from "@astralbeam/brand/logo/svg/astralbeam-wordmark-light.svg?url&no-inline"
import { Avatar, AvatarFallback, AvatarImage } from "@astralbeam/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@astralbeam/ui/components/dropdown-menu"
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
} from "@astralbeam/ui/components/sidebar"
import { Link } from "@tanstack/react-router"

import { OrganizationSwitcherControl } from "@/components/organization-switcher"

const signOutParams = { path: "sign-out" }

type DashboardUser = {
  email: string
  image?: null | string | undefined
  name: string
}

type DashboardSidebarProps = {
  user: DashboardUser
}

export function DashboardSidebar({ user }: DashboardSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link aria-label="AstralBeam dashboard" to="/dashboard" />}
              size="lg"
            >
              <img alt="" className="h-5 w-auto" src={astralbeamLightWordmarkUrl} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrganizationSwitcherControl
          align="start"
          className="w-full justify-between border bg-sidebar"
          hideSlug={false}
          side="right"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive render={<Link to="/dashboard" />} tooltip="Dashboard">
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <DashboardProfile user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function DashboardProfile({ user }: DashboardSidebarProps) {
  const { isMobile } = useSidebar()
  const initials = user.name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <Avatar size="sm">
              {user.image ? <AvatarImage alt={user.name} src={user.image} /> : null}
              <AvatarFallback>{initials || "?"}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-muted-foreground">{user.email}</span>
            </span>
            <span aria-hidden="true" className="text-muted-foreground">
              •••
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="min-w-0">
                <span className="block truncate font-medium text-foreground">{user.name}</span>
                <span className="block truncate">{user.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={<Link params={signOutParams} to="/auth/$path" />}
              variant="destructive"
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
