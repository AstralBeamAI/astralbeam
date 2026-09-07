import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { isSlugAvailable } from "@/db/lib/slug.server"
import { agent } from "@/db/schema.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { CheckAgentSlugInputSchema } from "../-lib/schemas.ts"

export const checkAgentSlugAvailability = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(Schema.toStandardSchemaV1(CheckAgentSlugInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      isSlugAvailable({
        table: agent,
        slug: data.slug,
        scope: eq(agent.organizationId, context.organizationId),
      }),
    )
  )
