import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { isSlugAvailable } from "@/db/lib/slug.server"
import { agent } from "@/db/schema.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { SlugSchema } from "@/lib/schemas"

export const checkOrganizationAgentSlugAvailability = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("update")])
  .validator(Schema.toStandardSchemaV1(SlugSchema))
  .handler(({ context, data: slug }) =>
    runDatabaseEffect(
      isSlugAvailable({
        table: agent,
        slug,
        scope: eq(agent.organizationId, context.organizationId),
      }),
    )
  )
