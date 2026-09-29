import { createServerFn } from "@tanstack/react-start"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { toValidationSchema } from "@/lib/schemas"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"

/** The organization, role, and permissions a layout renders around, read without writing. */
export const getOrganizationRouteContext = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context }) => context)
