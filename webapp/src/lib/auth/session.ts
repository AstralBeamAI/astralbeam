import { ensureSession } from "@better-auth-ui/core"
import type { QueryClient } from "@tanstack/react-query"
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start"

import { authClient } from "@/lib/auth/client"

/** Reconcile and return the authenticated user's organization-routing decision. */
const getSessionAccessDecision = createServerFn({ method: "POST" }).handler(
  async () => {
    const { getSessionAccessDecisionForRequest } = await import(
      "@/lib/auth/session.server"
    )
    return getSessionAccessDecisionForRequest()
  },
)

/** Seed Better Auth UI's session query while resolving the server-authoritative route decision. */
export const getRouteSessionAccessDecision = createIsomorphicFn()
  .server(async (queryClient: QueryClient) => {
    const { getSessionAccessDecisionForRequest } = await import(
      "@/lib/auth/session.server"
    )
    return getSessionAccessDecisionForRequest(queryClient)
  })
  .client(async (queryClient: QueryClient) => {
    const [, access] = await Promise.all([
      ensureSession(queryClient, authClient),
      getSessionAccessDecision(),
    ])
    return access
  })
