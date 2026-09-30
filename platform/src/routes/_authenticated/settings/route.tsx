import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { Spinner } from "@/components/ui/spinner"
import { AppShell } from "../-components/app-shell"
import { getLandingOrganization } from "../-lib/landing-organization"

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/settings" || location.pathname === "/settings/") {
      throw redirect({ to: "/settings/account", replace: true })
    }
  },
  // The account and security pages are user-level, so the sidebar follows the organization the
  // session lands on rather than a slug in the URL, and renders without one it cannot read.
  loader: async ({ context: { access } }) => ({
    organization: await getLandingOrganization(access),
  }),
  component: SettingsLayout,
  pendingComponent: SettingsLayoutPending,
})

function SettingsLayout() {
  const { organization } = Route.useLoaderData()

  return (
    <AppShell organization={organization}>
      <Outlet />
    </AppShell>
  )
}

function SettingsLayoutPending() {
  return (
    <main className="grid min-h-svh place-items-center" aria-busy="true">
      <Spinner className="size-6" />
    </main>
  )
}
