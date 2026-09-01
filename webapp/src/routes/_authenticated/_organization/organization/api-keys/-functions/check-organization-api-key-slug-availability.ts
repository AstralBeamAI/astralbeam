import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { isSlugAvailable } from "@/db/lib/slug.server"
import { apiKey } from "@/db/schema.server"
import { organizationApiKeyAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { SlugSchema } from "@/lib/schemas"

export const checkOrganizationApiKeySlugAvailability = createServerFn({ method: "POST" })
  .middleware([organizationApiKeyAccessMiddleware("create")])
  .validator(Schema.toStandardSchemaV1(SlugSchema))
  .handler(({ context, data: slug }) =>
    runDatabaseEffect(
      isSlugAvailable({
        table: apiKey,
        slug,
        scope: eq(apiKey.organizationId, context.organizationId),
      }),
    )
  )
