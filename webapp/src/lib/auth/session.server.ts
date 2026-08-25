import { authQueryKeys } from "@better-auth-ui/core"
import { ensureSessionServer } from "@better-auth-ui/core/server"
import type { QueryClient } from "@tanstack/react-query"
import { getRequest, setResponseHeader } from "@tanstack/react-start/server"

import { getAuth } from "@/lib/auth.server"
import { reconcileSessionAccess, type SessionAccessDecision } from "@/lib/auth/session-access"
import "@tanstack/react-start/server-only"

const SESSION_ACCESS_ERROR = "Unable to determine organization access"

export async function getSessionAccessDecisionForRequest(
  queryClient?: QueryClient,
): Promise<SessionAccessDecision> {
  const request = getRequest()
  const headers = request.headers

  setResponseHeader("Cache-Control", "no-store")
  setResponseHeader("Vary", "Cookie, Authorization")

  try {
    const auth = await getAuth()
    const session = queryClient
      ? await ensureSessionServer(queryClient, auth, { headers })
      : await auth.api.getSession({ headers })

    const access = await reconcileSessionAccess(
      session
        ? {
          userId: session.user.id,
          activeOrganizationId: session.session.activeOrganizationId ?? null,
        }
        : null,
      {
        listOrganizations: () => auth.api.listOrganizations({ headers }),
        setActiveOrganization: async (organizationId) => {
          const organization = await auth.api.setActiveOrganization({
            headers,
            body: { organizationId },
          })

          if (organization?.id !== organizationId) {
            throw new Error(SESSION_ACCESS_ERROR)
          }
        },
      },
    )

    if (
      queryClient &&
      session &&
      access.status === "ready" &&
      session.session.activeOrganizationId !== access.organizationId
    ) {
      queryClient.setQueryData(authQueryKeys.session, {
        ...session,
        session: {
          ...session.session,
          activeOrganizationId: access.organizationId,
        },
      })
    }

    return access
  } catch (error) {
    console.error(
      SESSION_ACCESS_ERROR,
      error instanceof Error ? error.name : "UnknownError",
    )
    throw new Error(SESSION_ACCESS_ERROR)
  }
}
