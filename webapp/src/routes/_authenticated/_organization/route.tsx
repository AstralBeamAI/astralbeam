import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "../-components/app-sidebar"

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: ({ context: { access } }) => {
    if (access.status === "onboarding") {
      throw redirect({ href: "/onboarding", replace: true })
    }
  },
  component: OrganizationLayout,
})

function OrganizationLayout() {
  const router = useRouter()

  return (
    <SidebarProvider>
      <AppSidebar onOrganizationChange={() => router.invalidate()} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
          <SidebarTrigger />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
