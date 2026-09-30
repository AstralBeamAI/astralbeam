import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"

import { PublicNavbar } from "@/components/navbar"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth/client"
import { isValidSlug } from "@/lib/organizations/slug"
import { AppShell } from "../-components/app-shell"
import { getOrganizationRouteContext } from "../-functions/get-organization-route-context"
import { throwOrganizationRouteError } from "./-lib/route-errors"

export const Route = createFileRoute("/_authenticated/$orgSlug")({
  beforeLoad: async ({ params }) => {
    if (!isValidSlug(params.orgSlug)) throw notFound()
    const organization = await getOrganizationRouteContext({
      data: { organizationSlug: params.orgSlug },
    }).catch((error: unknown) => throwOrganizationRouteError(error, params.orgSlug))
    return { organization }
  },
  component: OrganizationLayout,
  // Without this the layout renders while its own `beforeLoad` is still resolving, before the
  // organization is in route context.
  pendingComponent: OrganizationLayoutSkeleton,
  notFoundComponent: OrganizationNotFound,
})

function OrganizationLayout() {
  const { access, organization } = Route.useRouteContext()
  const landingOrganizationId = access.status === "ready" ? access.organizationId : null

  // Reading never moves the session's active organization, so a rendered page does, and `/` and
  // the user settings pages then follow the organization last shown.
  useEffect(() => {
    if (landingOrganizationId === organization.organizationId) return
    void authClient.organization.setActive({ organizationId: organization.organizationId })
  }, [landingOrganizationId, organization.organizationId])

  return (
    <AppShell organization={organization}>
      <Outlet key={organization.organizationId} />
    </AppShell>
  )
}

function OrganizationLayoutSkeleton() {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-48 w-full max-w-4xl rounded-xl" />
      </div>
    </AppShell>
  )
}

// A missing organization and a non-member answer identically, so neither reveals the other.
function OrganizationNotFound() {
  return (
    <>
      <PublicNavbar />
      <main className="container mx-auto space-y-2 p-4 pt-16">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This page does not exist, or you are not a member of its organization.
        </p>
        <Link to="/" className="text-sm underline underline-offset-4">
          Go to your dashboard
        </Link>
      </main>
    </>
  )
}
