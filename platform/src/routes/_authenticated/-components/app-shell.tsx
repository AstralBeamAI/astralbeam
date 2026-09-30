import { ListIcon } from "@phosphor-icons/react"
import type { ReactNode } from "react"

import { DocsLink, Navbar, UnderNavbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { DogfoodChatTrigger } from "./dogfood-chat"

/** Lays the dashboard navbar across the top, with `sidebar` and the page beneath it. */
export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <SidebarProvider className="flex-col">
      <AppNavbar />
      <div className="flex flex-1 **:data-[slot=sidebar-container]:top-14 **:data-[slot=sidebar-container]:h-[calc(100svh-3.5rem)]">
        {sidebar}
        <SidebarInset>
          <UnderNavbar>{children}</UnderNavbar>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

function AppNavbar() {
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
    >
      <DocsLink />
      <DogfoodChatTrigger />
    </Navbar>
  )
}
