import type { SessionAccessDecision } from "@/lib/auth/session-access"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { getOrganizationRouteContext } from "../-functions/get-organization-route-context"

function organizationUnavailableAsNull(error: unknown): null {
  const { tag } = parseServerFnError(error)
  if (tag === "OrganizationNotFound" || tag === "OrganizationAccessDenied") return null
  throw error
}

/** The organization a user-level page's sidebar follows, or null when the session lands on none. */
export async function getLandingOrganization(access: SessionAccessDecision) {
  return access.status === "ready"
    ? await getOrganizationRouteContext({
        data: { organizationSlug: access.organizationSlug },
      }).catch(organizationUnavailableAsNull)
    : null
}
