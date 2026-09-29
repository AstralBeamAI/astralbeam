import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router"
import { useEffect } from "react"

import { ThemeToggle } from "@/components/theme-toggle"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth/client"
import { isValidSlug } from "@/lib/organizations/slug"
import { AppSidebar } from "../-components/app-sidebar"
import { DogfoodChatTrigger } from "../-components/dogfood-chat"
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
    <SidebarProvider>
      <AppSidebar organization={organization} />
      <SidebarInset>
        <OrganizationLayoutHeader />
        <Outlet key={organization.organizationId} />
      </SidebarInset>
    </SidebarProvider>
  )
}

function OrganizationLayoutHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
      <SidebarTrigger />
      <div className="ms-auto flex items-center gap-2">
        <DogfoodChatTrigger />
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Static, so a pending navigation mounts none of the sidebar's live queries. */
function OrganizationLayoutSkeleton() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Skeleton className="h-12 w-full" />
        </SidebarHeader>
        <SidebarContent className="gap-2 p-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <OrganizationLayoutHeader />
        <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-48 w-full max-w-4xl rounded-xl" />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

// A missing organization and a non-member answer identically, so neither reveals the other.
function OrganizationNotFound() {
  return (
    <main className="container mx-auto space-y-2 p-4 pt-16">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        This page does not exist, or you are not a member of its organization.
      </p>
      <Link to="/" className="text-sm underline underline-offset-4">
        Go to your dashboard
      </Link>
    </main>
  )
}
