import { Effect } from "effect"

import { Auth } from "./auth.server.ts"
import { decideSessionAccess } from "./session-access.ts"

/**
 * The signed-in session, its organizations, and the organization-routing decision they imply.
 * Reads only, so previews and preloads never move the session's active organization.
 */
export const resolveSessionAccess = Effect.fn("resolveSessionAccess")(function* (headers: Headers) {
  const auth = yield* Auth
  const session = yield* auth.getSession({ headers })
  if (!session) return { session, organizations: [], access: decideSessionAccess(null, []) }
  const organizations = yield* auth.api((api) => api.listOrganizations({ headers }))
  const access = decideSessionAccess(
    {
      userId: session.user.id,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    },
    organizations,
  )
  return { session, organizations, access }
})
