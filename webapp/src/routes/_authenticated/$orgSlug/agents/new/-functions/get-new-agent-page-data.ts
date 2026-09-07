import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationAgentFormOptions } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { OrganizationSlugInputSchema } from "../../-lib/schemas.ts"

export const getNewAgentPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(Schema.toStandardSchemaV1(OrganizationSlugInputSchema))
  .handler(({ context }) =>
    runDatabaseEffect(
      Effect.map(
        readOrganizationAgentFormOptions(context.organizationId),
        ({ sandboxProviders }) => ({
          data: { sandboxProviders },
          permissions: context.permissions,
        }),
      ),
    )
  )
