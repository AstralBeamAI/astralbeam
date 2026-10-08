import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import {
  catalogModelUsageConfiguration,
  readModelPriceCatalog,
} from "@/lib/model-providers/pricing-catalog.server"
import { ModelProviderFieldsSchema, ProviderModelFieldsSchema } from "@/lib/model-providers/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getModelUsageDefaults = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        organizationSlug: SlugSchema,
        providerType: ModelProviderFieldsSchema.fields.providerType,
        modelId: ProviderModelFieldsSchema.fields.modelId,
      }),
    ),
  )
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.map(readModelPriceCatalog, (catalog) =>
        catalogModelUsageConfiguration({
          catalog,
          providerType: data.providerType,
          modelId: data.modelId,
        }),
      ),
      serverFnMeta.name,
    ),
  )
