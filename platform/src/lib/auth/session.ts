import { authQueryKeys } from "@better-auth-ui/core"
import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import type { QueryClient } from "@tanstack/react-query"
import { createIsomorphicFn, createServerFn, createServerOnlyFn } from "@tanstack/react-start"
import { getRequest, setResponseHeader } from "@tanstack/react-start/server"

import { resolveSessionAccess } from "@/lib/auth/session.server"
import { runEffect } from "@/lib/runtime/server-fn.server"

const resolveRequestSessionAccess = createServerOnlyFn((operation: string) => {
  setResponseHeader("Cache-Control", "no-store")
  setResponseHeader("Vary", "Cookie, Authorization")
  return runEffect(resolveSessionAccess(getRequest().headers), operation)
})

const getSessionAccess = createServerFn({ method: "GET" }).handler(({ serverFnMeta }) =>
  resolveRequestSessionAccess(serverFnMeta.name),
)

type SessionAccess = Awaited<ReturnType<typeof getSessionAccess>>

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

/** The server-authoritative organization-routing decision for the signed-in user. */
export const getRouteSessionAccessDecision = createIsomorphicFn()
  .server(async (queryClient: QueryClient) =>
    seedSessionAccess(queryClient, await resolveRequestSessionAccess("getRouteSessionAccess")),
  )
  .client(async (queryClient: QueryClient) =>
    seedSessionAccess(queryClient, await getSessionAccess()),
  )
