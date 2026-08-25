import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "../-components/app-sidebar"

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/account", replace: true })
    }
  },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { access } = Route.useRouteContext()
  const router = useRouter()

  if (access.status !== "ready") {
    return (
      <main className="min-h-svh bg-background">
        <Outlet />
      </main>
    )
  }

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
