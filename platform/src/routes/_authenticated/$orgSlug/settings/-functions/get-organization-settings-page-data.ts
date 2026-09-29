import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationOpenaiApiKeyHint } from "@/db/organization-openai-api-key.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { getGlobalConfig } from "@/lib/config"
import { toValidationSchema, SlugSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(toValidationSchema(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(async ({ context }) => {
    const dogfood = (await getGlobalConfig("dogfood_organization_id")) === context.organizationId
    return runDatabaseEffect(
      // The last four characters name the stored key for whoever is about to replace it. Nothing
      // more of it reaches the browser.
      readOrganizationOpenaiApiKeyHint(context.organizationId).pipe(
        Effect.map((openaiApiKeyLast4) => ({
          data: {
            organization: {
              name: context.organizationName,
              slug: context.organizationSlug,
              dogfood,
            },
            openaiApiKeyLast4,
          },
          permissions: context.permissions,
        })),
      ),
    )
  })
