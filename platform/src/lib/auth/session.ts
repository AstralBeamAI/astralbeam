import { ensureSession } from "@better-auth-ui/core"
import type { QueryClient } from "@tanstack/react-query"
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start"

import { getSessionAccessDecisionForRequest } from "@/lib/auth/session.server"
import { authClient } from "@/lib/auth/client"

/** Reconcile and return the authenticated user's organization-routing decision. */
const getSessionAccessDecision = createServerFn({ method: "POST" }).handler(() =>
  getSessionAccessDecisionForRequest(),
)

/** Seed Better Auth UI's session query while resolving the server-authoritative route decision. */
export const getRouteSessionAccessDecision = createIsomorphicFn()
  .server((queryClient: QueryClient) => getSessionAccessDecisionForRequest(queryClient))
  .client(async (queryClient: QueryClient) => {
    const [, access] = await Promise.all([
      ensureSession(queryClient, authClient),
      getSessionAccessDecision(),
    ])
    return access
  })
