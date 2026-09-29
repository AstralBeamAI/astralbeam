import { getRequest, setResponseHeader } from "@tanstack/react-start/server"
import { Effect, Option, Schema } from "effect"

import { readOrganizationMembership } from "@/db/organization.server"
import { getAuth } from "@/lib/auth.server"
import { isSetupComplete } from "@/lib/config/state.server"
import {
  authorizeOrganizationRole,
  deriveOrganizationPermissions,
  type OrganizationPermissionRequest,
  type OrganizationPermissions,
} from "@/lib/auth/organization-access"
import { SlugSchema } from "@/lib/schemas"
import { OrganizationAccessDenied, OrganizationNotFound, SignInRequired } from "./errors.ts"

export interface OrganizationAccess {
  readonly organizationId: string
  readonly organizationSlug: string
  readonly organizationName: string
  readonly role: string
  readonly permissions: OrganizationPermissions
}

class OrganizationSessionError extends Schema.TaggedError<OrganizationSessionError>()(
  "OrganizationSessionError",
  { cause: Schema.Defect() },
) {}

const decodeOrganizationSlugInput = Schema.decodeUnknownOption(
  Schema.Struct({ organizationSlug: SlugSchema }),
)

/**
 * Resolves the organization a server function was called for from its own validated input, then
 * the caller's membership and role. The organization ID is never read from the request.
 */
export function requireOrganizationAccess(input: {
  data: unknown
  permissions?: OrganizationPermissionRequest
}) {
  const headers = getRequest().headers
  setResponseHeader("Cache-Control", "no-store")
  return Effect.gen(function* () {
    const slugInput = decodeOrganizationSlugInput(input.data)
    if (Option.isNone(slugInput)) return yield* new OrganizationNotFound()
    const access = yield* resolveOrganizationAccess(slugInput.value.organizationSlug, headers)
    if (access === null) return yield* new OrganizationNotFound()
    if (input.permissions && !authorizeOrganizationRole(access.role, input.permissions)) {
      return yield* new OrganizationAccessDenied()
    }
    return access
  })
}

/**
 * Answers `null` for a missing organization and a non-member alike, and points the session's
 * active organization at the URL, which Better Auth's member and api-key APIs read.
 */
export function resolveOrganizationRouteAccess(organizationSlug: string) {
  const headers = getRequest().headers
  setResponseHeader("Cache-Control", "no-store")
  return resolveOrganizationAccess(organizationSlug, headers, { synchronizeActive: true })
}

function resolveOrganizationAccess(
  organizationSlug: string,
  headers: Headers,
  options?: { synchronizeActive: boolean },
) {
  return Effect.gen(function* () {
    const configured = yield* Effect.tryPromise({
      try: isSetupComplete,
      catch: (cause) => new OrganizationSessionError({ cause }),
    })
    if (!configured) return yield* new OrganizationAccessDenied()
    const auth = yield* Effect.tryPromise({
      try: () => getAuth(),
      catch: (cause) => new OrganizationSessionError({ cause }),
    })
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers, query: { disableCookieCache: true } }),
      catch: (cause) => new OrganizationSessionError({ cause }),
    })
    if (!session) return yield* new SignInRequired()

    const membership = yield* readOrganizationMembership({
      organizationSlug,
      userId: session.user.id,
    })
    if (!membership) return null

    if (
      options?.synchronizeActive &&
      session.session.activeOrganizationId !== membership.organizationId
    ) {
      yield* Effect.tryPromise({
        try: () =>
          auth.api.setActiveOrganization({
            headers,
            body: { organizationId: membership.organizationId },
          }),
        catch: (cause) => new OrganizationSessionError({ cause }),
      })
    }

    return {
      organizationId: membership.organizationId,
      organizationSlug: membership.organizationSlug,
      organizationName: membership.organizationName,
      role: membership.role,
      permissions: deriveOrganizationPermissions(membership.role),
    } satisfies OrganizationAccess
  })
}
