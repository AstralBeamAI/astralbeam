import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"

import type {
  OrganizationApiKeyAction,
  OrganizationConfigurationAction,
} from "./organization-configuration-access.server.ts"

type OrganizationAccess =
  | { resource: "apiKey"; action: OrganizationApiKeyAction }
  | { resource: "organizationConfiguration"; action: OrganizationConfigurationAction }

const authorizeOrganizationAccess = createServerOnlyFn(async (access: OrganizationAccess) => {
  const authorization = await import("./organization-configuration-access.server.ts")
  return Effect.runPromise(
    access.resource === "apiKey"
      ? authorization.requireOrganizationApiKeyAccess(access.action)
      : authorization.requireOrganizationConfigurationAccess(access.action),
  )
})

export function organizationConfigurationAccessMiddleware(
  action: OrganizationConfigurationAction,
) {
  return organizationAccessMiddleware({ resource: "organizationConfiguration", action })
}

export function organizationApiKeyAccessMiddleware(action: OrganizationApiKeyAction) {
  return organizationAccessMiddleware({ resource: "apiKey", action })
}

function organizationAccessMiddleware(access: OrganizationAccess) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const { organizationId } = await authorizeOrganizationAccess(access)
    return next({ context: { organizationId } })
  })
}
