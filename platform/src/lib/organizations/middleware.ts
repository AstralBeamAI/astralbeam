import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start"
import { Effect, Option, Schema } from "effect"

import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import type { OrganizationPermissionRequest } from "./access.ts"
import { OrganizationNotFound } from "./errors.ts"
import { Organizations } from "./organizations.server.ts"
import { OrganizationRouteInputSchema } from "./schemas.ts"

const decodeOrganizationSlugInput = Schema.decodeUnknownOption(OrganizationRouteInputSchema)

const authorizeOrganizationRequest = createServerOnlyFn(
  (input: { operation: string; data: unknown; permissions?: OrganizationPermissionRequest }) =>
    runEffect(
      Effect.gen(function* () {
        const server = yield* ServerRequest
        // Access depends on the caller's session, so no cache may keep the response.
        yield* server.setHeaders({ "Cache-Control": "no-store" })
        const slugInput = decodeOrganizationSlugInput(input.data)
        if (Option.isNone(slugInput)) return yield* new OrganizationNotFound()
        const organizations = yield* Organizations
        return yield* organizations.access({
          headers: server.request.headers,
          organizationSlug: slugInput.value.organizationSlug,
          permissions: input.permissions,
        })
      }).pipe(
        Effect.catchTag(
          ["SignInRequired", "OrganizationNotFound", "OrganizationAccessDenied"],
          exposeError,
        ),
      ),
      input.operation,
    ),
)

/** Resolves the organization from the function's own `organizationSlug` input, never an ID, and
 * enforces membership plus one permission when given. Route guards never stand in for this. */
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
