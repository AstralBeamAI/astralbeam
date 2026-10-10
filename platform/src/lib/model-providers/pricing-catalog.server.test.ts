import { describe, expect, test } from "vitest"

import { catalogModelConfiguration, effectiveModelConfiguration } from "./pricing-catalog.server.ts"
import type { ModelPriceCatalog } from "./pricing-catalog-schemas.ts"
import { modelInputAllowance, type ModelConfiguration } from "./schemas.ts"

const modelTestConfiguration: ModelConfiguration = {
  currency: "USD",
  pricingSource: { kind: "manual" },
  prices: { inputPerMillion: "2", outputPerMillion: "8" },
  contextTiers: [],
  maxInputTokens: 128_000,
  contextWindowTokens: null,
  maxOutputTokens: 8192,
  outputCap: 4096,
}

const testPriceCatalog: ModelPriceCatalog = {
  providers: [
    {
      id: "openai",
      api_pattern: "api.openai.com",
      models: [
        {
          id: "test-model",
          match: { equals: "test-model" },
          context_window: 128_000,
          prices: {
            input_mtok: {
              base: 2,
              tiers: [
                { start: 60_000, price: 6 },
                { start: 20_000, price: 4 },
              ],
            },
            output_mtok: 8,
            cache_read_mtok: 0.25,
            cache_write_mtok: 1 / 24,
          },
        },
      ],
    },
  ],
}

describe("model pricing catalog", () => {
  test("maps supported prices and preserves manual overrides during catalog updates", () => {
    const lookup = {
      catalog: testPriceCatalog,
      providerType: "openai" as const,
      modelId: "test-model",
    }
    const card = catalogModelConfiguration(lookup)!
    expect(modelInputAllowance(card)).toBe(128_000)
    expect(modelInputAllowance({ ...card, outputCap: 1024 })).toBe(128_000)
    expect(card.prices).toEqual({
      inputPerMillion: "2",
      outputPerMillion: "8",
      cacheReadPerMillion: "0.25",
      cacheWritePerMillion: "0.041666666667",
    })
    expect(card.contextTiers).toMatchObject([
      { aboveInputTokens: 20_000, prices: { inputPerMillion: "4" } },
      { aboveInputTokens: 60_000, prices: { inputPerMillion: "6" } },
    ])
    expect(catalogModelConfiguration({ ...lookup, modelId: "unknown" })).toBeNull()
    const unsupported = {
      ...testPriceCatalog,
      providers: [
        {
          ...testPriceCatalog.providers[0]!,
          models: [
            {
              ...testPriceCatalog.providers[0]!.models[0]!,
              prices: { input_audio_mtok: 1, input_mtok: 2, output_mtok: 8 },
            },
          ],
        },
      ],
    }
    expect(catalogModelConfiguration({ ...lookup, catalog: unsupported })).toBeNull()
    expect(effectiveModelConfiguration({ ...lookup, configured: modelTestConfiguration })).toBe(
      modelTestConfiguration,
    )
    const configured = {
      ...modelTestConfiguration,
      outputCap: 1024,
      pricingSource: { kind: "catalog" as const, modelId: "test-model" },
    }
    expect(effectiveModelConfiguration({ ...lookup, configured })).toMatchObject({
      outputCap: 4096,
      maxInputTokens: 128_000,
      contextWindowTokens: null,
      prices: { inputPerMillion: "2" },
      contextTiers: [{ aboveInputTokens: 20_000 }, { aboveInputTokens: 60_000 }],
    })
    expect(effectiveModelConfiguration({ ...lookup, modelId: "unknown", configured })).toBe(
      configured,
    )
  })
})
