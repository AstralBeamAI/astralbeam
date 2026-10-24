import { isDeepStrictEqual } from "node:util"

import type { ModelPriceVersion, ModelPricingChange } from "./schemas.ts"

export function activeModelPrice(input: {
  history: readonly ModelPriceVersion[]
  timestamp: Date
}) {
  return input.history.findLast((version) => version.effectiveFrom <= input.timestamp.toISOString())
}

/** Apply explicit pricing edits under the provider lock. Effective versions stay immutable. */
export function updateModelPriceHistory(input: {
  history: readonly ModelPriceVersion[]
  change: ModelPricingChange | undefined
  timestamp: Date
}): readonly ModelPriceVersion[] | null {
  if (input.history.length && !input.change) return input.history
  const now = input.timestamp.toISOString()
  const active = activeModelPrice(input)
  const { policy, scheduledPrices } = input.change ?? {}
  if (policy && input.change!.expectedVersionId !== (active?.id ?? null)) return null
  const past = input.history.filter((version) => version.effectiveFrom <= now)
  const future =
    policy?.kind === "catalog"
      ? []
      : (scheduledPrices ?? input.history.filter((version) => version.effectiveFrom > now))
  if (
    future.some(
      (version) => version.effectiveFrom <= now || past.some(({ id }) => id === version.id),
    )
  )
    return null
  if (!active || (policy && !isDeepStrictEqual(active.policy, policy))) {
    if (active?.effectiveFrom === now) return null
    past.push({
      id: crypto.randomUUID(),
      effectiveFrom: now,
      policy: policy ?? { kind: "catalog" },
    })
  }
  return [...past, ...future].toSorted((left, right) =>
    left.effectiveFrom.localeCompare(right.effectiveFrom),
  )
}
