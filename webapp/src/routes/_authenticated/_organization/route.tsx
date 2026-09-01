import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { AppSidebar } from "../-components/app-sidebar"

export const Route = createFileRoute("/_authenticated/_organization")({
  beforeLoad: ({ context: { access } }) => {
    if (access.status !== "ready") {
      throw redirect({ href: "/onboarding", replace: true })
    }
    return {
      organizationId: access.organizationId,
      organizationSlug: access.organizationSlug,
    }
  },
  component: OrganizationLayout,
})

function OrganizationLayout() {
  const router = useRouter()
  const { organizationId } = Route.useRouteContext()
  const [organizationSwitchPending, setOrganizationSwitchPending] = useState(false)

  const handleOrganizationChange = async (phase: "error" | "start" | "success") => {
    if (phase !== "success") {
      setOrganizationSwitchPending(phase === "start")
      return
    }
    try {
      await router.invalidate({ sync: true })
      setOrganizationSwitchPending(false)
    } catch {
      globalThis.location.reload()
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar onOrganizationChange={handleOrganizationChange} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/70 sm:px-4">
          <SidebarTrigger />
        </header>
        <div className={organizationSwitchPending ? "hidden" : "contents"}>
          <Outlet key={organizationId} />
        </div>
        {organizationSwitchPending && (
          <div
            className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8"
            aria-busy="true"
            aria-label="Switching organization"
          >
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-48 w-full max-w-2xl rounded-xl" />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}
