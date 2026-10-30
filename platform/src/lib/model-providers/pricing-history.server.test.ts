import { expect, test } from "vitest"
import { updateModelPriceHistory } from "./pricing-history.server"

test("only changes future prices and cancels them when restoring catalog pricing", () => {
  const history = [
    {
      id: crypto.randomUUID(),
      effectiveFrom: "2026-10-23T10:00:00.000Z",
      policy: { kind: "manual" as const, prices: { inputPerMillion: "2", outputPerMillion: "8" } },
    },
    {
      id: crypto.randomUUID(),
      effectiveFrom: "2026-10-24T10:00:00.000Z",
      policy: { kind: "manual" as const, prices: { inputPerMillion: "3", outputPerMillion: "12" } },
    },
  ]
  const timestamp = new Date("2026-10-23T11:00:00.000Z")
  const change = { expectedVersionId: history[0]!.id }
  for (const invalid of [
    { ...history[1]!, id: history[0]!.id },
    { ...history[1]!, effectiveFrom: timestamp.toISOString() },
  ]) {
    expect(
      updateModelPriceHistory({
        history,
        timestamp,
        change: { ...change, scheduledPrices: [invalid] },
      }),
    ).toBeNull()
  }
  expect(
    updateModelPriceHistory({
      history,
      timestamp,
      change: { ...change, policy: { kind: "catalog" } },
    }),
  ).toEqual([
    history[0],
    expect.objectContaining({
      effectiveFrom: timestamp.toISOString(),
      policy: { kind: "catalog" },
    }),
  ])
})
