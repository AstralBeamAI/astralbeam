import type { ANTHROPIC_MODELS } from "@tanstack/ai-anthropic"
import type { OPENAI_CHAT_MODELS } from "@tanstack/ai-openai"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import {
  effectiveModelConfiguration,
  readModelPriceCatalog,
} from "@/lib/model-providers/pricing-catalog.server"
import type { ModelProviderType } from "@/lib/model-providers/schemas"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { ModelProviderPageInputSchema } from "../-lib/schemas"

// Current provider lineups. GPT-6 tool restrictions keep it out of OpenRouter's Chat Completions suggestions.
// https://developers.openai.com/api/docs/guides/latest-model | https://platform.claude.com/docs/en/models/overview | https://ai.google.dev/gemini-api/docs/models
const modelProviderSuggestions: Record<ModelProviderType, readonly string[]> = {
  openai: [
    "gpt-6.1-sol",
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ] satisfies readonly (typeof OPENAI_CHAT_MODELS)[number][],
  anthropic: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-4-5",
    "claude-fable-5-1",
  ] satisfies readonly (typeof ANTHROPIC_MODELS)[number][],
  openrouter: [
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "anthropic/claude-opus-5.5",
    "anthropic/claude-sonnet-5.5",
    "anthropic/claude-haiku-5.5",
    "anthropic/claude-fable-5.1",
    "google/gemini-3.8-flash",
    "google/gemini-3.5-flash-lite",
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
                  configuration: null,
                })),
                ...(provider?.providerType === providerType ? provider.models : []),
              ].map((model) => [model.modelId, model]),
            ).values(),
          ].map((model) => ({
            modelId: model.modelId,
            name: model.name,
            configuration: effectiveModelConfiguration({
              catalog: pricing,
              providerType,
              modelId: model.modelId,
              configured:
                model.configuration?.pricingSource.kind === "catalog" ? model.configuration : null,
            }),
          }))
        const catalog = {
          openai: pricedModels("openai"),
          anthropic: pricedModels("anthropic"),
          openrouter: pricedModels("openrouter"),
        }
        return {
          data: { provider, catalog },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
