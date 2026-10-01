import { ANTHROPIC_MODELS } from "@tanstack/ai-anthropic"
import { OPENAI_CHAT_MODELS } from "@tanstack/ai-openai"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import type { ModelProviderType, ProviderModelFields } from "@/lib/model-providers/schemas"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { ModelProviderPageInputSchema } from "../-lib/schemas"

// Suggestions are a subset of the public catalog. https://openrouter.ai/api/v1/models
const openRouterModelSuggestions = [
  "openai/gpt-5.4",
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3-flash-preview",
]

const modelProviderCatalog: Record<ModelProviderType, readonly ProviderModelFields[]> = {
  openai: OPENAI_CHAT_MODELS.map((modelId) => ({ modelId, name: modelId })),
  anthropic: ANTHROPIC_MODELS.map((modelId) => ({ modelId, name: modelId })),
  openrouter: openRouterModelSuggestions.map((modelId) => ({ modelId, name: modelId })),
}

export const getModelProviderPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(ModelProviderPageInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const providers = yield* ModelProviders
        const provider =
          data.id === null
            ? null
            : yield* providers.get({
                organizationId: context.organizationId,
                id: data.id,
              })
        return {
          data: { provider, catalog: modelProviderCatalog },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
