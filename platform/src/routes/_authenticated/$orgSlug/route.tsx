import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { authQueryKeys } from "@better-auth-ui/core"
import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { PublicNavbar } from "@/components/navbar"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth/client"
import { AppShell } from "../-components/app-shell"
import { useDogfoodChat } from "../-components/dogfood-chat"
import { getOrganizationRouteContext } from "../-functions/get-organization-route-context"
import { throwOrganizationRouteError } from "./-lib/route-errors"

export const Route = createFileRoute("/_authenticated/$orgSlug")({
  beforeLoad: async ({ context: { access, queryClient }, params }) => {
    const organization = await queryClient
      .fetchQuery({
        // Role mutations invalidate fullDetails. Session and membership updates select fresh data.
        queryKey: [
          ...organizationQueryKeys.fullDetails(access.userId),
          params.orgSlug,
          queryClient.getQueryState(authQueryKeys.session)?.dataUpdatedAt,
          queryClient.getQueryState(organizationQueryKeys.list(access.userId))?.dataUpdatedAt,
        ],
        queryFn: () => getOrganizationRouteContext({ data: { organizationSlug: params.orgSlug } }),
      })
      .catch((error: unknown) => throwOrganizationRouteError(error, params.orgSlug))
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
  const queryClient = useQueryClient()

  // Reading never moves the session's active organization, so a rendered page does, and `/` and
  // the user settings pages then follow the organization last shown.
  useEffect(() => {
    if (landingOrganizationId === organization.organizationId) return
    void authClient.organization.setActive({
      organizationId: organization.organizationId,
      fetchOptions: {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: authQueryKeys.session }),
      },
    })
  }, [landingOrganizationId, organization.organizationId, queryClient])

  return <Outlet />
}

function OrganizationLayoutSkeleton() {
  const chat = useDogfoodChat()
  const content = (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-48 w-full max-w-4xl rounded-xl" />
    </div>
  )
  // Refreshes retain the mounted shell and chat; first loads still need their own shell.
  return chat ? content : <AppShell>{content}</AppShell>
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
