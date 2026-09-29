import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Config } from "@/lib/config/config.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { readOrganizationOpenaiApiKeyHint } from "@/lib/organizations/openai-api-key.server"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const dogfoodOrganizationId = yield* Effect.flatMap(Config, (config) =>
          config.get("dogfood_organization_id"),
        )
        // The last four characters name the stored key for whoever is about to replace it.
        // Nothing more of it reaches the browser.
        const openaiApiKeyLast4 = yield* readOrganizationOpenaiApiKeyHint(context.organizationId)
        return {
          data: {
            organization: {
              id: context.organizationId,
              name: context.organizationName,
              slug: context.organizationSlug,
              dogfood: dogfoodOrganizationId === context.organizationId,
            },
            openaiApiKeyLast4,
          },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
