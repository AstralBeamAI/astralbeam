import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationOpenaiApiKeyHint } from "@/db/organization-openai-api-key.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) =>
    runDatabaseEffect(
      // The last four characters name the stored key for whoever is about to replace it. Nothing
      // more of it reaches the browser.
      readOrganizationOpenaiApiKeyHint(context.organizationId).pipe(
        Effect.map((openaiApiKeyLast4) => ({
          data: {
            organization: {
              name: context.organizationName,
              slug: context.organizationSlug,
            },
            openaiApiKeyLast4,
          },
          permissions: context.permissions,
        })),
      ),
    )
  )
