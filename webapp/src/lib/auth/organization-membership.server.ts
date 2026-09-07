import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { readOrganizationMembership } from "@/db/organization.server"
import { getAuth } from "@/lib/auth.server"
import {
  authorizeOrganizationRole,
  deriveOrganizationPermissions,
  type OrganizationPermissionRequest,
  type OrganizationPermissions,
} from "@/lib/auth/organization-access"
import { SlugSchema } from "@/lib/schemas"

export interface OrganizationAccess {
  readonly organizationId: string
  readonly organizationSlug: string
  readonly organizationName: string
  readonly role: string
  readonly permissions: OrganizationPermissions
}

export class OrganizationAccessError extends Data.TaggedError("OrganizationAccessError")<{
  readonly message: string
  readonly status: 401 | 403 | 404
}> {}

class OrganizationSessionError extends Data.TaggedError("OrganizationSessionError")<{
  readonly cause: unknown
}> {}

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
  return Effect.gen(function* () {
    const slugInput = decodeOrganizationSlugInput(input.data)
    if (Option.isNone(slugInput)) return yield* denyOrganizationAccess(404)
    const access = yield* resolveOrganizationAccess(slugInput.value.organizationSlug)
    if (access === null) return yield* denyOrganizationAccess(404)
    if (input.permissions && !authorizeOrganizationRole(access.role, input.permissions)) {
      return yield* denyOrganizationAccess(403)
    }
    return access
  })
}

/**
 * Answers `null` for a missing organization and a non-member alike, and points the session's
 * active organization at the URL, which Better Auth's member and api-key APIs read.
 */
export function resolveOrganizationRouteAccess(organizationSlug: string) {
  return resolveOrganizationAccess(organizationSlug, { synchronizeActive: true })
}

function resolveOrganizationAccess(
  organizationSlug: string,
  options?: { synchronizeActive: boolean },
) {
  return Effect.gen(function* () {
    const headers = getRequest().headers
    setResponseHeader("Cache-Control", "no-store")
    const auth = yield* Effect.tryPromise({
      try: () => getAuth(),
      catch: (cause) => new OrganizationSessionError({ cause }),
    })
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers, query: { disableCookieCache: true } }),
      catch: (cause) => new OrganizationSessionError({ cause }),
    })
    if (!session) return yield* denyOrganizationAccess(401)

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

function denyOrganizationAccess(
  status: 401 | 403 | 404,
): Effect.Effect<never, OrganizationAccessError> {
  return Effect.failSync(() => {
    setResponseStatus(status)
    return new OrganizationAccessError({
      status,
      message: status === 401 ? "Authentication required" : "Organization is unavailable",
    })
  })
}
