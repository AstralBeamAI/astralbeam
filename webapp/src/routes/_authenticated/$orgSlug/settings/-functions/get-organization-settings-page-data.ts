import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationOpenaiApiKeyConfigured } from "@/db/organization-openai-api-key.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) =>
    runDatabaseEffect(
      // Presence only, never the key itself: this payload reaches the browser.
      readOrganizationOpenaiApiKeyConfigured(context.organizationId).pipe(
        Effect.map((openaiApiKeyConfigured) => ({
          data: {
            organization: {
              name: context.organizationName,
              slug: context.organizationSlug,
            },
            openaiApiKeyConfigured,
          },
          permissions: context.permissions,
        })),
      ),
    )
  )
