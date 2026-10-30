import { authQueryKeys, fetchSession } from "@better-auth-ui/core"
import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import type { QueryClient } from "@tanstack/react-query"
import { createIsomorphicFn, createServerOnlyFn } from "@tanstack/react-start"

import { authClient } from "@/lib/auth/client"
import { decideSessionAccess } from "@/lib/auth/session-access"
import { resolveSessionAccess } from "@/lib/auth/session.server"
import { runEffect } from "@/lib/runtime/server-fn.server"

const resolveRequestSessionAccess = createServerOnlyFn((operation: string) =>
  runEffect(resolveSessionAccess(), operation),
)

type SessionAccess = Awaited<ReturnType<typeof resolveRequestSessionAccess>>

/** Seeds Better Auth UI's session and organization list queries with what routing just read. */
function seedSessionAccess(queryClient: QueryClient, result: SessionAccess) {
  queryClient.setQueryData(authQueryKeys.session, result.session)
  if (result.session) {
    queryClient.setQueryData(
      organizationQueryKeys.list(result.session.user.id),
      result.organizations,
    )
  }
  return result.access
}

/** Navigation reuses Better Auth UI's queries. Server operations still authorize each request. */
export const getRouteSessionAccessDecision = createIsomorphicFn()
  .server(async (queryClient: QueryClient) =>
    seedSessionAccess(queryClient, await resolveRequestSessionAccess("getRouteSessionAccess")),
  )
  .client(async (queryClient: QueryClient) => {
    const session = await fetchSession(queryClient, authClient)
    if (!session) return decideSessionAccess(null, [])
    const organizations = await queryClient.fetchQuery({
      queryKey: organizationQueryKeys.list(session.user.id),
      queryFn: ({ signal }) =>
        authClient.organization.list({ fetchOptions: { signal, throw: true } }),
    })
    return decideSessionAccess(
      {
        userId: session.user.id,
        activeOrganizationId: session.session.activeOrganizationId ?? null,
      },
      organizations ?? [],
    )
  })
