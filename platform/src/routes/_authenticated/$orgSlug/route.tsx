import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { authQueryKeys, getSession } from "@better-auth-ui/core"
import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { PublicNavbar } from "@/components/navbar"
import { Skeleton } from "@/components/ui/skeleton"
import { authClient } from "@/lib/auth/client"
import { AppShell } from "../-components/app-shell"
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
  const switchScope = `active-organization:${access.userId}`
  const { mutate: setActive } = useMutation({
    mutationKey: [switchScope],
    scope: { id: switchScope },
    mutationFn: async (organizationId: string) => {
      if (getSession(queryClient, authClient)?.user.id !== access.userId) return
      await authClient.organization.setActive({ organizationId, fetchOptions: { throw: true } })
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.session })
    },
  })

  // A pending switch can overwrite the session even if it still matches the route now.
  useEffect(() => {
    if (
      landingOrganizationId !== organization.organizationId ||
      queryClient.isMutating({ mutationKey: [switchScope], exact: true }) > 0
    )
      setActive(organization.organizationId)
  }, [landingOrganizationId, organization.organizationId, queryClient, setActive, switchScope])

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
