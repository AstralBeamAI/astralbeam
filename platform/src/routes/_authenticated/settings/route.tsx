import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { ThemeToggle } from "@/components/theme-toggle"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { AppSidebar } from "../-components/app-sidebar"
import { getOrganizationRouteContext } from "../-functions/get-organization-route-context"

function organizationUnavailableAsNull(error: unknown): null {
  const { tag } = parseServerFnError(error)
  if (tag === "OrganizationNotFound" || tag === "OrganizationAccessDenied") return null
  throw error
}

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/account", replace: true })
    }
  },
  // The account and security pages are user-level, so the sidebar follows the organization the
  // session lands on rather than a slug in the URL, and renders without one it cannot read.
  loader: async ({ context: { access } }) => ({
    organization:
      access.status === "ready"
        ? await getOrganizationRouteContext({
            data: { organizationSlug: access.organizationSlug },
          }).catch(organizationUnavailableAsNull)
        : null,
  }),
  component: SettingsLayout,
  pendingComponent: SettingsLayoutPending,
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
          <ThemeToggle className="ms-auto" />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

function SettingsLayoutPending() {
  return (
    <main className="grid min-h-svh place-items-center" aria-busy="true">
      <Spinner className="size-6" />
    </main>
  )
}
