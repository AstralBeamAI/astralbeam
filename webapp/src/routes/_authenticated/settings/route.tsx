import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "../-components/app-sidebar"
import { getOrganizationRouteContext } from "../$orgSlug/-functions/get-organization-route-context"

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/account", replace: true })
    }
  },
  // The account and security pages are user-level, so the sidebar follows the session's own
  // active organization rather than a slug in the URL.
  loader: async ({ context: { access } }) =>
    access.status === "ready"
      ? {
        organization: await getOrganizationRouteContext({
          data: { organizationSlug: access.organizationSlug },
        }),
      }
      : { organization: null },
  component: SettingsLayout,
})

function SettingsLayout() {
  const { organization } = Route.useLoaderData()

  if (!organization) {
    return (
      <main className="min-h-svh bg-background">
        <Outlet />
      </main>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar organization={organization} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
          <SidebarTrigger />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
