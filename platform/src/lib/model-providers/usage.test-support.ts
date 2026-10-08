import type { ModelUsageConfiguration } from "./usage-schemas.ts"

export const modelUsageTestConfiguration: ModelUsageConfiguration = {
  currency: "USD",
  pricingSource: { kind: "manual" },
  prices: { inputPerMillion: "2", outputPerMillion: "8" },
  contextTiers: [],
  maxInputTokens: 128_000,
  contextWindowTokens: null,
  maxOutputTokens: 8192,
  outputCap: 4096,
}
