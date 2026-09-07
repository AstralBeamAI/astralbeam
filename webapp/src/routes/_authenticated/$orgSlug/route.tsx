import { createFileRoute, notFound, Outlet } from "@tanstack/react-router"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { isValidSlug } from "@/lib/slug"
import { AppSidebar } from "../-components/app-sidebar"
import { getOrganizationRouteContext } from "./-functions/get-organization-route-context"

export const Route = createFileRoute("/_authenticated/$orgSlug")({
  beforeLoad: async ({ params }) => {
    if (!isValidSlug(params.orgSlug)) throw notFound()
    const organization = await getOrganizationRouteContext({
      data: { organizationSlug: params.orgSlug },
    })
    // A missing organization and a non-member answer identically, so neither reveals the other.
    if (!organization) throw notFound()
    return { organization }
  },
  component: OrganizationLayout,
  // Without this the layout renders while its own `beforeLoad` is still resolving, before the
  // organization is in route context.
  pendingComponent: OrganizationLayoutSkeleton,
})

function OrganizationLayout() {
  const { orgSlug } = Route.useParams()
  const { organization } = Route.useRouteContext()

  return (
    <SidebarProvider>
      <AppSidebar organization={organization} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
          <SidebarTrigger />
        </header>
        <Outlet key={orgSlug} />
      </SidebarInset>
    </SidebarProvider>
  )
}

function OrganizationLayoutSkeleton() {
  return (
    <SidebarProvider>
      <AppSidebar organization={null} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-48 w-full max-w-4xl rounded-xl" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
