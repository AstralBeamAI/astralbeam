import { describe, expect, test } from "vitest"
import { effectiveModelConfiguration } from "./pricing-catalog.server"
import { updateModelPriceHistory } from "./pricing-history.server"
import type { ModelConfiguration, ProviderModelFields } from "./schemas"

const manualPricing: ModelConfiguration = {
  currency: "USD",
  pricingSource: { kind: "manual" },
  prices: { inputPerMillion: "2", outputPerMillion: "8" },
  contextTiers: [],
  maxInputTokens: 128_000,
  contextWindowTokens: null,
  maxOutputTokens: 8192,
  outputCap: 4096,
}

describe("effective manual pricing", () => {
  test("preserves active history while scheduling, replacing, cancelling and restoring catalog pricing", () => {
    const timestamp = new Date("2026-10-23T10:00:00.000Z")
    const model: ProviderModelFields = {
      modelId: "test",
      name: "Test",
      configuration: manualPricing,
    }
    const history = updateModelPriceHistory({ history: [], model, timestamp })!
    expect(
      effectiveModelConfiguration({
        catalog: { providers: [] },
        providerType: "openai",
        modelId: "test",
        configured: manualPricing,
        history,
        timestamp: new Date(timestamp.getTime() - 1),
      }),
    ).toBeNull()
    const next = {
      ...history[0]!,
      id: crypto.randomUUID(),
      effectiveFrom: "2026-10-24T10:00:00.000Z",
      rates: { ...history[0]!.rates!, prices: { inputPerMillion: "3", outputPerMillion: "12" } },
    }
    const input = {
      history,
      timestamp: new Date(timestamp.getTime() + 1),
      model: { ...model, priceVersionId: history[0]!.id, scheduledPrices: [next] },
    }
    const scheduled = updateModelPriceHistory(input)!
    expect(scheduled).toEqual([...history, next])
    const lookup = {
      catalog: { providers: [] },
      providerType: "openai" as const,
      modelId: "test",
      configured: manualPricing,
      history: scheduled,
    }
    expect(
      effectiveModelConfiguration({ ...lookup, timestamp: new Date("2026-10-24T09:59:59.999Z") })
        ?.prices,
    ).toEqual(manualPricing.prices)
    expect(
      effectiveModelConfiguration({ ...lookup, timestamp: new Date(next.effectiveFrom) })?.prices,
    ).toEqual(next.rates.prices)
    const edited = {
      ...next,
      rates: { ...next.rates, prices: { inputPerMillion: "4", outputPerMillion: "16" } },
    }
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        model: { ...input.model, scheduledPrices: [edited] },
      }),
    ).toEqual([...history, edited])
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        model: { ...input.model, scheduledPrices: [] },
      }),
    ).toEqual(history)
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        timestamp: new Date(next.effectiveFrom),
      }),
    ).toBeNull()
    expect(
      updateModelPriceHistory({
        ...input,
        model: { ...input.model, scheduledPrices: [{ ...next, id: history[0]!.id }] },
      }),
    ).toBeNull()
    const restored = updateModelPriceHistory({
      ...input,
      history: scheduled,
      model: {
        ...input.model,
        configuration: { ...manualPricing, pricingSource: { kind: "catalog", modelId: "test" } },
      },
    })!
    expect(restored).toHaveLength(2)
    expect(restored[0]).toEqual(history[0])
    expect(restored[1]!.rates).toBeNull()
  })
})
