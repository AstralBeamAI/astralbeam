import { calcPrice, findProvider, type Provider } from "@pydantic/genai-prices"
import { BigDecimal, Effect, Hash, Option, Schema } from "effect"

import { Config } from "@/lib/config/config.server"
import {
  ModelPriceCatalogProvidersSchema,
  type ModelPriceCatalog,
} from "./pricing-catalog-schemas.ts"
import { ModelUsageConfigurationSchema, type ModelUsageConfiguration } from "./usage-schemas.ts"
import type { ModelProviderType } from "./schemas.ts"

const bundledModelProviders = Schema.decodeUnknownSync(ModelPriceCatalogProvidersSchema)(
  ["openai", "anthropic", "openrouter"].map((id) => findProvider({ providerId: id })),
)
const bundledModelPriceCatalog: ModelPriceCatalog = {
  revision: `genai-prices-v2:bundled:${Hash.string(JSON.stringify(bundledModelProviders))}`,
  fetchedAt: null,
  providers: bundledModelProviders,
}

export const readModelPriceCatalog = Effect.gen(function* () {
  const config = yield* Config
  return (yield* config.readModelPriceCatalog) ?? bundledModelPriceCatalog
})

const modelCatalogPriceKeys = {
  inputPerMillion: "input_mtok",
  outputPerMillion: "output_mtok",
  cacheReadPerMillion: "cache_read_mtok",
  cacheWritePerMillion: "cache_write_mtok",
  cacheWrite1hPerMillion: "cache_write_1h_mtok",
} as const

export function catalogModelUsageConfiguration(input: {
  catalog: ModelPriceCatalog
  providerType: ModelProviderType
  modelId: string
}): ModelUsageConfiguration | null {
  const provider = input.catalog.providers.find((item) => item.id === input.providerType)
  if (!provider) return null
  const result = calcPrice({}, input.modelId, { provider: provider as Provider })
  if (!result?.model.context_window) return null
  const prices = result.model_price
  // Native provider tools are excluded from this rate card. Chat declares function tools only.
  // https://github.com/pydantic/genai-prices/tree/main/prices/new_data/v2
  const supportedKeys = [
    ...Object.values(modelCatalogPriceKeys),
    "web_searches_kcount",
    "storage_searches_kcount",
  ]
  if (Object.keys(prices).some((key) => !supportedKeys.includes(key))) return null
  if (prices.input_mtok === undefined || prices.output_mtok === undefined) return null
  const thresholds = [
    ...new Set(
      Object.values(prices).flatMap((price) =>
        typeof price === "object" ? price.tiers.map((tier) => tier.start) : [],
      ),
    ),
  ].sort((left, right) => left - right)
  const ratesAt = (tokens: number) =>
    Object.fromEntries(
      Object.entries(modelCatalogPriceKeys).flatMap(([field, key]) => {
        const price = prices[key]
        if (price === undefined) return []
        const value =
          typeof price === "number"
            ? price
            : price.tiers
                .toSorted((left, right) => left.start - right.start)
                .reduce((current, tier) => (tokens > tier.start ? tier.price : current), price.base)
        // Round conservatively to the rate-card precision, including fractional cache rates.
        return [[field, BigDecimal.format(BigDecimal.ceil(BigDecimal.fromNumberUnsafe(value), 12))]]
      }),
    )
  const decoded = Schema.decodeUnknownOption(ModelUsageConfigurationSchema)({
    currency: "USD",
    pricingSource: { kind: "catalog", modelId: result.model.id },
    prices: ratesAt(0),
    contextTiers: thresholds.map((aboveInputTokens) => ({
      aboveInputTokens,
      prices: ratesAt(aboveInputTokens + 1),
    })),
    maxInputTokens: result.model.context_window,
    contextWindowTokens: null,
    maxOutputTokens: 4096,
    outputCap: 4096,
  })
  return Option.getOrNull(decoded)
}

export function effectiveModelUsageConfiguration(input: {
  catalog: ModelPriceCatalog
  providerType: ModelProviderType
  modelId: string
  configured: ModelUsageConfiguration | null | undefined
}) {
  const configured = input.configured
  if (configured?.pricingSource.kind === "manual") return configured
  return catalogModelUsageConfiguration(input) ?? configured ?? null
}
