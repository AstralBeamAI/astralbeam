import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { requireOrganizationAccess } from "./organization-membership.server.ts"
import type { OrganizationPermissionRequest } from "./organization-access.ts"

const authorizeOrganizationRequest = createServerOnlyFn(
  (input: { operation: string; data: unknown; permissions?: OrganizationPermissionRequest }) =>
    runEffect(
      requireOrganizationAccess(input).pipe(
        Effect.catchTag(
          ["SignInRequired", "OrganizationNotFound", "OrganizationAccessDenied"],
          exposeError,
        ),
      ),
      input.operation,
    ),
)

/**
 * Resolves the organization from the function's own `organizationSlug` input and enforces the
 * caller's membership, plus one permission when given. Route guards never stand in for this.
 */
export function organizationAccessMiddleware(permissions?: OrganizationPermissionRequest) {
  return createMiddleware({ type: "function" }).server(async ({ data, next, serverFnMeta }) => {
    const access = await authorizeOrganizationRequest({
      operation: serverFnMeta.name,
      data,
      ...(permissions ? { permissions } : {}),
    })
    return next({ context: access })
  })
}
