import { describe, expect, test } from "vitest"
import { effectiveModelConfiguration } from "./pricing-catalog.server"
import { updateModelPriceHistory } from "./pricing-history.server"
import type { ModelLimits, ModelPricePolicy } from "./schemas"

const historyTestLimits: ModelLimits = {
  maxInputTokens: 128_000,
  contextWindowTokens: null,
  maxOutputTokens: 8192,
  outputCap: 4096,
}
const historyTestPolicy: ModelPricePolicy = {
  kind: "manual",
  prices: { inputPerMillion: "2", outputPerMillion: "8" },
}

describe("effective manual pricing", () => {
  test("preserves effective policies while scheduling, editing, cancelling and restoring catalog pricing", () => {
    const timestamp = new Date("2026-10-23T10:00:00.000Z")
    const history = updateModelPriceHistory({
      history: [],
      timestamp,
      change: { expectedVersionId: null, policy: historyTestPolicy },
    })!
    const lookup = {
      catalog: { providers: [] },
      providerType: "openai" as const,
      modelId: "test",
      configured: historyTestLimits,
      history,
    }
    expect(
      effectiveModelConfiguration({ ...lookup, timestamp: new Date(timestamp.getTime() - 1) }),
    ).toBeNull()
    const next = {
      id: crypto.randomUUID(),
      effectiveFrom: "2026-10-24T10:00:00.000Z",
      policy: { kind: "manual" as const, prices: { inputPerMillion: "3", outputPerMillion: "12" } },
    }
    const input = {
      history,
      timestamp: new Date(timestamp.getTime() + 1),
      change: { expectedVersionId: history[0]!.id, scheduledPrices: [next] },
    }
    const scheduled = updateModelPriceHistory(input)!
    expect(scheduled).toEqual([...history, next])
    expect(
      effectiveModelConfiguration({
        ...lookup,
        history: scheduled,
        timestamp: new Date("2026-10-24T09:59:59.999Z"),
      })?.prices,
    ).toEqual(historyTestPolicy.prices)
    expect(
      effectiveModelConfiguration({
        ...lookup,
        history: scheduled,
        timestamp: new Date(next.effectiveFrom),
      })?.prices,
    ).toEqual(next.policy.prices)
    const edited = {
      ...next,
      policy: { kind: "manual" as const, prices: { inputPerMillion: "4", outputPerMillion: "16" } },
    }
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        change: { ...input.change, scheduledPrices: [edited] },
      }),
    ).toEqual([...history, edited])
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        change: { ...input.change, scheduledPrices: [] },
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
        change: { ...input.change, scheduledPrices: [{ ...next, id: history[0]!.id }] },
      }),
    ).toBeNull()
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        timestamp: new Date(next.effectiveFrom),
        change: undefined,
      }),
    ).toEqual(scheduled)
    expect(
      updateModelPriceHistory({
        ...input,
        history: scheduled,
        timestamp: new Date(next.effectiveFrom),
        change: { ...input.change, policy: historyTestPolicy },
      }),
    ).toBeNull()
    const restored = updateModelPriceHistory({
      ...input,
      history: scheduled,
      change: { ...input.change, policy: { kind: "catalog" } },
    })!
    expect(restored).toHaveLength(2)
    expect(restored[0]).toEqual(history[0])
    expect(restored[1]!.policy).toEqual({ kind: "catalog" })
  })
})
