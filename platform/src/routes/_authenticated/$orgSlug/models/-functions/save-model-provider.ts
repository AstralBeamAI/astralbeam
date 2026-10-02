import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { SaveModelProviderInputSchema } from "../-lib/schemas"

export const saveModelProvider = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(SaveModelProviderInputSchema, strictParseOptions))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(ModelProviders, (providers) =>
        providers.save({
          organizationId: context.organizationId,
          id: data.id,
          lockVersion: data.lockVersion,
          name: data.name,
          providerType: data.providerType,
          api: data.api,
          baseUrl: data.baseUrl,
          apiKey: data.apiKey,
          models: data.models,
        }),
      ).pipe(
        Effect.catchTag(
          [
            "ModelProviderChanged",
            "ModelProviderEndpointNotAllowed",
            "ModelProviderNameTaken",
            "ModelProviderInUse",
            "ModelProviderUnreadable",
            "ModelProviderKeyMissing",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
