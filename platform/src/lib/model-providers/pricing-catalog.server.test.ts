import { describe, expect, test } from "vitest"
import { Schema } from "effect"

import { catalogModelConfiguration, effectiveModelConfiguration } from "./pricing-catalog.server.ts"
import { ModelPriceCatalogSchema, type ModelPriceCatalog } from "./pricing-catalog-schemas.ts"
import { modelInputAllowance } from "./schemas.ts"

const catalogTestManualPrices = { inputPerMillion: "5", outputPerMillion: "15" }

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
  test("selects dated rates at the request start, including the exact boundary", () => {
    const catalog: ModelPriceCatalog = {
      providers: [
        {
          ...testPriceCatalog.providers[0]!,
          models: [
            {
              ...testPriceCatalog.providers[0]!.models[0]!,
              prices: [
                { prices: { input_mtok: 2, output_mtok: 8 } },
                {
                  constraint: { type: "start_date", start_date: "2026-10-22" },
                  prices: { input_mtok: 3, output_mtok: 12 },
                },
              ],
            },
          ],
        },
      ],
    }
    const lookup = { catalog, providerType: "openai" as const, modelId: "test-model" }
    for (const invalid of ["2026-02-30", "2026-10-22T12:00:00Z"]) {
      expect(
        Schema.is(ModelPriceCatalogSchema)(
          JSON.parse(JSON.stringify(catalog).replace("2026-10-22", invalid)),
        ),
      ).toBe(false)
    }
    expect(
      catalogModelConfiguration({
        ...lookup,
        timestamp: new Date("2026-10-21T23:59:59.999Z"),
      })?.prices,
    ).toEqual({ inputPerMillion: "2", outputPerMillion: "8" })
    expect(
      effectiveModelConfiguration({
        ...lookup,
        configured: null,
        timestamp: new Date("2026-10-22T00:00:00Z"),
      })?.prices,
    ).toEqual({ inputPerMillion: "3", outputPerMillion: "12" })
  })

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
    // The catalog names xAI's provider x-ai.
    const xaiCatalog = { providers: [{ ...testPriceCatalog.providers[0]!, id: "x-ai" }] }
    expect(
      catalogModelConfiguration({ ...lookup, catalog: xaiCatalog, providerType: "xai" })?.prices,
    ).toEqual(card.prices)
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
    const limits = {
      maxInputTokens: 128_000,
      contextWindowTokens: null,
      maxOutputTokens: 8192,
      outputCap: 1024,
    }
    const history = [
      {
        id: crypto.randomUUID(),
        effectiveFrom: "2020-01-01T00:00:00.000Z",
        policy: { kind: "manual" as const, prices: catalogTestManualPrices },
      },
    ]
    expect(effectiveModelConfiguration({ ...lookup, configured: limits, history })).toMatchObject({
      ...limits,
      prices: catalogTestManualPrices,
      pricingSource: { kind: "manual" },
      contextTiers: [],
    })
    expect(effectiveModelConfiguration({ ...lookup, configured: limits })).toMatchObject({
      ...limits,
      prices: { inputPerMillion: "2" },
      contextTiers: [{ aboveInputTokens: 20_000 }, { aboveInputTokens: 60_000 }],
    })
    expect(
      effectiveModelConfiguration({ ...lookup, modelId: "unknown", configured: limits }),
    ).toBeNull()
  })
})
