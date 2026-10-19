import type { QueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"

import type { OrganizationAccess } from "@/lib/organizations/access"
import { throwOrganizationRouteError } from "./route-errors"

export function organizationPageLoader<Data>(
  page: string,
  load: (options: { data: { organizationSlug: string }; signal: AbortSignal }) => Promise<Data>,
) {
  return {
    // Recheck access before exposing cached data, including after a role change.
    // https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#stale-reload-mode
    staleReloadMode: "blocking" as const,
    handler: ({
      context,
      params,
    }: {
      context: {
        queryClient: QueryClient
        access: { userId: string }
        organization: OrganizationAccess
      }
      params: { orgSlug: string }
    }) => {
      const { queryClient, access, organization } = context
      return queryClient
        .fetchQuery({
          queryKey: [
            organization.organizationId,
            "pages",
            access.userId,
            organization.memberId,
            organization.role,
            organization.permissions,
            page,
          ],
          queryFn: ({ signal }) => load({ data: { organizationSlug: params.orgSlug }, signal }),
        })
        .catch((error: unknown) => throwOrganizationRouteError(error, params.orgSlug))
    },
  }
}

export function useInvalidateOrganizationPages() {
  const { queryClient, organization } = getRouteApi("/_authenticated/$orgSlug").useRouteContext()
  return () => invalidateOrganizationPages(queryClient, organization.organizationId)
}

export async function invalidateOrganizationPages(
  queryClient: QueryClient,
  organizationId: string,
) {
  const filters = { queryKey: [organizationId, "pages"] }
  await queryClient.cancelQueries(filters)
  await queryClient.invalidateQueries(filters)
}
