import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationAgents } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { OrganizationSlugInputSchema } from "../-lib/schemas.ts"

export const getAgentsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(Schema.toStandardSchemaV1(OrganizationSlugInputSchema))
  .handler(({ context }) =>
    runDatabaseEffect(
      Effect.map(readOrganizationAgents(context.organizationId), (data) => ({
        data,
        permissions: context.permissions,
      })),
    )
  )
