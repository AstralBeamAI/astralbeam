import { createServerFn } from "@tanstack/react-start"
import { Clock, Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import {
  catalogModelUsageConfiguration,
  readModelPriceCatalog,
} from "@/lib/model-providers/pricing-catalog.server"
import type { ModelProviderType } from "@/lib/model-providers/schemas"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { ModelProviderPageInputSchema } from "../-lib/schemas"

// Curated current chat models, rather than the SDK's full legacy catalog.
// https://developers.openai.com/api/docs/models | https://platform.claude.com/docs/en/models/overview | https://openrouter.ai/rankings
const modelProviderSuggestions: Record<ModelProviderType, readonly string[]> = {
  openai: ["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra"],
  anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
  openrouter: [
    "openai/gpt-5.6-luna",
    "anthropic/claude-sonnet-5.5",
    "anthropic/claude-opus-5.5",
    "google/gemini-3.8-flash",
    "z-ai/glm-5.3-flash",
  ],
}

export const getModelProviderPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(ModelProviderPageInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const providers = yield* ModelProviders
        const pricing = yield* readModelPriceCatalog
        const provider =
          data.id === null
            ? null
            : yield* providers.get({
                organizationId: context.organizationId,
                id: data.id,
              })
        const pricedModels = (providerType: ModelProviderType) =>
          [
            ...new Map(
              [
                ...modelProviderSuggestions[providerType].map((modelId) => ({
                  modelId,
                  name: modelId,
                })),
                ...(provider?.providerType === providerType ? provider.models : []),
              ].map((model) => [model.modelId, model]),
            ).values(),
          ].map((model) => ({
            modelId: model.modelId,
            name: model.name,
            usageConfiguration: catalogModelUsageConfiguration({
              catalog: pricing,
              providerType,
              modelId: model.modelId,
            }),
          }))
        const catalog = {
          openai: pricedModels("openai"),
          anthropic: pricedModels("anthropic"),
          openrouter: pricedModels("openrouter"),
        }
        const now = yield* Clock.currentTimeMillis
        return {
          data: {
            provider,
            catalog,
            pricingFetchedAt: pricing.fetchedAt,
            pricingIsStale:
              pricing.fetchedAt !== null &&
              now - Date.parse(pricing.fetchedAt) > 48 * 60 * 60 * 1000,
          },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
