import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { TestModelProviderInputSchema } from "../-lib/schemas"

export const testModelProvider = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["test"] })])
  .validator(toValidationSchema(TestModelProviderInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(ModelProviders, (providers) =>
        providers.testModel({
          organizationId: context.organizationId,
          id: data.id,
          lockVersion: data.lockVersion,
          modelId: data.modelId,
        }),
      ).pipe(
        Effect.catchTag(
          [
            "ModelProviderChanged",
            "ModelProviderUnreadable",
            "ModelUsageConfigurationMissing",
            "ModelProviderTestFailed",
            "ModelProviderTestRateLimited",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
