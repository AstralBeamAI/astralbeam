import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import { toValidationSchema } from "@/lib/schemas"

import { runDatabaseEffect } from "@/db"
import { readOrganizationSandboxProviderSummaries } from "@/lib/sandboxes/providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationSlugInputSchema } from "../-lib/schemas.ts"

export const getSandboxesPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationSlugInputSchema))
  .handler(({ context }) =>
    runDatabaseEffect(
      Effect.map(
        readOrganizationSandboxProviderSummaries(context.organizationId),
        (sandboxProviders) => ({
          data: { sandboxProviders },
          permissions: context.permissions,
        }),
      ),
    ),
  )
