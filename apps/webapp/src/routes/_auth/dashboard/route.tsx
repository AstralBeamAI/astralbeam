import { $getActiveMember } from "@astralbeam/auth/tanstack/functions"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@astralbeam/ui/components/sidebar"
import { TooltipProvider } from "@astralbeam/ui/components/tooltip"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardSidebar } from "@/components/dashboard-sidebar"

export const Route = createFileRoute("/_auth/dashboard")({
  beforeLoad: async ({ abortController }) => {
    const member = await $getActiveMember({ signal: abortController.signal })
    if (!member) throw redirect({ to: "/onboarding" })

    return {
      organization: {
        id: member.organizationId,
        memberId: member.id,
        role: member.role,
      },
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const { user } = Route.useRouteContext()

  return (
    <TooltipProvider>
      <SidebarProvider>
        <DashboardSidebar user={user} />
        <SidebarInset className="min-w-0 bg-muted/20">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger />
            <p className="text-xs font-medium">Dashboard</p>
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
