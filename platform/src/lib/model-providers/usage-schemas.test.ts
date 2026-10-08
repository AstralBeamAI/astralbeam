import { Schema } from "effect"
import { describe, expect, test } from "vitest"

import { modelUsageTestConfiguration } from "./usage.test-support.ts"
import { ModelUsageConfigurationSchema, modelInputAllowance } from "./usage-schemas.ts"

describe("model usage configuration", () => {
  test("requires explicit prices and usable token bounds, including zero prices", () => {
    const valid = Schema.is(ModelUsageConfigurationSchema)
    expect(
      valid({
        ...modelUsageTestConfiguration,
        prices: { inputPerMillion: "0", outputPerMillion: "0" },
      }),
    ).toBe(true)
    for (const fields of [
      { prices: { outputPerMillion: "8" } },
      { prices: { inputPerMillion: "-1", outputPerMillion: "8" } },
      { maxInputTokens: null },
      { outputCap: 8193 },
      { contextWindowTokens: 4096 },
      {
        contextTiers: [
          { aboveInputTokens: 100, prices: modelUsageTestConfiguration.prices },
          { aboveInputTokens: 99, prices: modelUsageTestConfiguration.prices },
        ],
      },
    ])
      expect(valid({ ...modelUsageTestConfiguration, ...fields })).toBe(false)
  })

  test("subtracts the output cap from shared context and respects the input maximum", () => {
    expect(
      modelInputAllowance({
        ...modelUsageTestConfiguration,
        contextWindowTokens: 8192,
      }),
    ).toBe(4096)
    expect(modelInputAllowance(modelUsageTestConfiguration)).toBe(128_000)
  })
})
