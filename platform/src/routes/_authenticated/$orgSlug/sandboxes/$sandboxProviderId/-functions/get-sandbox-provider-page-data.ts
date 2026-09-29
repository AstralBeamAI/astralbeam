import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import { toValidationSchema } from "@/lib/schemas"

import { runDatabaseEffect } from "@/db"
import { readOrganizationSandboxProvider } from "@/lib/sandboxes/providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { SandboxProviderIdInputSchema } from "../../-lib/schemas.ts"

export const getSandboxProviderPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(SandboxProviderIdInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      readOrganizationSandboxProvider(context.organizationId, data.sandboxProviderId).pipe(
        Effect.map((provider) =>
          provider === null ? null : { data: { provider }, permissions: context.permissions },
        ),
      ),
    ),
  )
