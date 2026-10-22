import { describe, expect, it } from "vitest"

import type { ModelConfiguration } from "./schemas.ts"
import { modelUsageCost } from "./usage-cost.ts"

const configuration: ModelConfiguration = {
  currency: "USD",
  pricingSource: { kind: "catalog", modelId: "model" },
  prices: { inputPerMillion: "3", outputPerMillion: "15", cacheReadPerMillion: "0.3" },
  contextTiers: [
    {
      aboveInputTokens: 200_000,
      prices: { inputPerMillion: "6", outputPerMillion: "22.5" },
    },
  ],
  maxInputTokens: 1_000_000,
  contextWindowTokens: null,
  maxOutputTokens: 64_000,
  outputCap: 4096,
}

describe("modelUsageCost", () => {
  it("prices cached input at its own rate and the rest at the input rate", () => {
    const usage = {
      promptTokens: 10_000,
      completionTokens: 1_000,
      promptTokensDetails: { cachedTokens: 8_000 },
    }
    // 2,000 × $3 + 8,000 × $0.30 + 1,000 × $15, per million tokens.
    expect(modelUsageCost(configuration, usage)).toBe("0.0234")
  })

  it("prices a call above a context threshold at that tier's rates", () => {
    const usage = { promptTokens: 250_000, completionTokens: 2_000 }
    expect(modelUsageCost(configuration, usage)).toBe("1.545")
  })

  it("prices merged requests at their own context tiers and cache rates", () => {
    const requestUsage = [
      {
        promptTokens: 150_000,
        completionTokens: 1_000,
        promptTokensDetails: { cachedTokens: 50_000 },
      },
      {
        promptTokens: 150_000,
        completionTokens: 1_000,
        promptTokensDetails: { cachedTokens: 50_000 },
      },
    ]
    expect(
      modelUsageCost(configuration, {
        promptTokens: 300_000,
        completionTokens: 2_000,
        promptTokensDetails: { cachedTokens: 100_000 },
        providerUsageDetails: { requestUsage },
      }),
    ).toBe("0.66")
  })
})
