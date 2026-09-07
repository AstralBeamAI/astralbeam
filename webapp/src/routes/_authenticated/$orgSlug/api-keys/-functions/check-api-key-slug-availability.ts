import { createServerFn } from "@tanstack/react-start"
import { eq } from "drizzle-orm"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { isSlugAvailable } from "@/db/lib/slug.server"
import { apiKey } from "@/db/schema.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const checkApiKeySlugAvailability = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ apiKey: ["create"] })])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ organizationSlug: SlugSchema, slug: SlugSchema }),
    ),
  )
  .handler(({ context, data }) =>
    runDatabaseEffect(
      isSlugAvailable({
        table: apiKey,
        slug: data.slug,
        scope: eq(apiKey.organizationId, context.organizationId),
      }),
    )
  )
