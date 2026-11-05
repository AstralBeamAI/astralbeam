import { createServerFn } from "@tanstack/react-start"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { getAvailableSandboxProviderIds } from "@/lib/sandboxes/availability.server"
import { toValidationSchema } from "@/lib/schemas"

export const getAvailableSandboxProviders = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(() => getAvailableSandboxProviderIds())
