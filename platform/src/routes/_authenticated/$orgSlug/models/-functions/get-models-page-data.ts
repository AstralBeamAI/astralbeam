import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { readOrganizationOpenaiApiKeyConfigured } from "@/lib/organizations/openai-api-key.server"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getModelsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const providers = yield* ModelProviders
        const [modelProviders, legacyKeyConfigured] = yield* Effect.all(
          [
            providers.list({ organizationId: context.organizationId }),
            readOrganizationOpenaiApiKeyConfigured(context.organizationId),
          ],
          { concurrency: "unbounded" },
        )
        return { data: { modelProviders, legacyKeyConfigured }, permissions: context.permissions }
      }),
      serverFnMeta.name,
    ),
  )
