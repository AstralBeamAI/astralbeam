import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationSandboxProviderSummaries } from "@/db/organization-sandbox-provider.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { OrganizationSlugInputSchema } from "../-lib/schemas.ts"

export const getSandboxesPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(Schema.toStandardSchemaV1(OrganizationSlugInputSchema))
  .handler(({ context }) =>
    runDatabaseEffect(
      Effect.map(
        readOrganizationSandboxProviderSummaries(context.organizationId),
        (sandboxProviders) => ({
          data: { sandboxProviders },
          permissions: context.permissions,
        }),
      ),
    )
  )
