import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

import { getAuth } from "@/lib/auth.server"

export type OrganizationConfigurationAction = "read" | "update" | "test" | "delete"
export type OrganizationApiKeyAction = "create" | "read" | "update" | "delete"
type OrganizationAccessPermission =
  | { readonly apiKey: [OrganizationApiKeyAction] }
  | { readonly organizationConfiguration: [OrganizationConfigurationAction] }

export class OrganizationConfigurationAccessError extends Data.TaggedError(
  "OrganizationConfigurationAccessError",
)<{
  readonly message: string
  readonly status: 401 | 403
}> {}

export class OrganizationConfigurationAuthorizationError extends Data.TaggedError(
  "OrganizationConfigurationAuthorizationError",
)<{ readonly cause: unknown }> {}

export function requireOrganizationConfigurationAccess(
  action: OrganizationConfigurationAction,
): Effect.Effect<
  { organizationId: string },
  OrganizationConfigurationAccessError | OrganizationConfigurationAuthorizationError
> {
  return requireOrganizationAccess({ organizationConfiguration: [action] })
}

export function requireOrganizationApiKeyAccess(action: OrganizationApiKeyAction) {
  return requireOrganizationAccess({ apiKey: [action] })
}

function requireOrganizationAccess(
  permissions: OrganizationAccessPermission,
): Effect.Effect<
  { organizationId: string },
  OrganizationConfigurationAccessError | OrganizationConfigurationAuthorizationError
> {
  return Effect.gen(function* () {
    const headers = getRequest().headers
    setResponseHeader("Cache-Control", "no-store")
    const access = yield* Effect.tryPromise({
      try: async () => {
        const auth = await getAuth()
        const session = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true },
        })
        if (!session) return { denied: 401 as const }
        const organizationId = session.session.activeOrganizationId
        if (!organizationId) return { denied: 403 as const }
        const permission = await auth.api.hasPermission({
          headers,
          body: { organizationId, permissions },
        })
        return permission.success ? { organizationId } : { denied: 403 as const }
      },
      catch: (cause) => new OrganizationConfigurationAuthorizationError({ cause }),
    })
    if ("denied" in access) return yield* denyOrganizationConfigurationAccess(access.denied)
    return access
  })
}

function denyOrganizationConfigurationAccess(
  status: 401 | 403,
): Effect.Effect<never, OrganizationConfigurationAccessError> {
  return Effect.failSync(() => {
    setResponseStatus(status)
    return new OrganizationConfigurationAccessError({
      status,
      message: status === 401
        ? "Authentication required"
        : "Organization configuration is unavailable",
    })
  })
}
