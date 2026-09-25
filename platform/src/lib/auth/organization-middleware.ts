import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"

import { runDatabaseEffect } from "@/db"
import { requireOrganizationAccess } from "./organization-membership.server.ts"
import type { OrganizationPermissionRequest } from "./organization-access.ts"

const authorizeOrganizationRequest = createServerOnlyFn(
  (input: { data: unknown; permissions?: OrganizationPermissionRequest }) =>
    runDatabaseEffect(requireOrganizationAccess(input)),
)

/**
 * Resolves the organization from the function's own `organizationSlug` input and enforces the
 * caller's membership, plus one permission when given. Route guards never stand in for this.
 */
export function organizationAccessMiddleware(permissions?: OrganizationPermissionRequest) {
  return createMiddleware({ type: "function" }).server(async ({ data, next }) => {
    const access = await authorizeOrganizationRequest({
      data,
      ...(permissions ? { permissions } : {}),
    })
    return next({ context: access })
  })
}
