import { ListIcon } from "@phosphor-icons/react"
import type { CSSProperties, ReactNode } from "react"

import { DocsLink, Navbar, NavbarCrumb, UnderNavbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import type { OrganizationAccess } from "@/lib/organizations/access"
import { AppOrganizationSwitcher, AppSidebar } from "./app-sidebar"
import { DogfoodChatTrigger } from "./dogfood-chat"

type AppShellProps = {
  /** Undefined while the organization layout loads. */
  organization?: OrganizationAccess
  children: ReactNode
}

/** Lays the dashboard navbar across the top, with the sidebar and the page beneath it. */
export function AppShell({ organization, children }: AppShellProps) {
  return (
    <SidebarProvider className="flex-col" style={{ "--sidebar-width": "14rem" } as CSSProperties}>
      <AppNavbar organization={organization} />
      <div className="flex flex-1 **:data-[slot=sidebar-container]:top-14 **:data-[slot=sidebar-container]:h-[calc(100svh-3.5rem)]">
        {organization === undefined ? (
          <AppSidebarSkeleton />
        ) : (
          <AppSidebar organization={organization} />
        )}
        <SidebarInset>
          <UnderNavbar>{children}</UnderNavbar>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

function AppNavbar({ organization }: { organization: AppShellProps["organization"] }) {
  const { toggleSidebar } = useSidebar()
  return (
    <Navbar
      start={
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Open menu"
          title="Open menu"
          onClick={toggleSidebar}
        >
          <ListIcon />
        </Button>
      }
      crumbs={
        // Below `md` the switcher would not fit, so the sidebar header holds it instead.
        <div className="hidden min-w-0 items-center gap-1 md:flex">
          <NavbarCrumb>
            {organization === undefined ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <AppOrganizationSwitcher organization={organization} className="h-8 min-w-0 py-0" />
            )}
          </NavbarCrumb>
        </div>
      }
    >
      <DocsLink />
      <DogfoodChatTrigger className="ms-2.5" />
    </Navbar>
  )
}

/** Static, so a pending navigation mounts none of the sidebar's live queries. */
function AppSidebarSkeleton() {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="gap-2 p-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </SidebarContent>
    </Sidebar>
  )
}
