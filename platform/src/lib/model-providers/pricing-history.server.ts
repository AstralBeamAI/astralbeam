import { isDeepStrictEqual } from "node:util"

import type { ModelConfiguration, ModelPriceVersion, ProviderModelFields } from "./schemas.ts"

export function activeModelPrice(input: {
  history: readonly ModelPriceVersion[]
  timestamp: Date
}) {
  return input.history.findLast((version) => version.effectiveFrom <= input.timestamp.toISOString())
}

function modelRateCard(configuration: ModelConfiguration) {
  const { currency, pricingSource, prices, contextTiers } = configuration
  return { currency, pricingSource, prices, contextTiers }
}

/** Only future versions are mutable. A null rate card restores automatic catalog pricing. */
export function updateModelPriceHistory(input: {
  history: readonly ModelPriceVersion[]
  model: ProviderModelFields
  timestamp: Date
}): readonly ModelPriceVersion[] | null {
  const now = input.timestamp.toISOString()
  const active = activeModelPrice(input)
  if ((input.model.priceVersionId ?? null) !== (active?.id ?? null)) return null
  const manual = input.model.configuration?.pricingSource.kind === "manual"
  const future = manual
    ? (input.model.scheduledPrices ??
      input.history.filter((version) => version.effectiveFrom > now))
    : []
  const past = input.history.filter((version) => version.effectiveFrom <= now)
  if (
    future.some(
      (version) => version.effectiveFrom <= now || past.some(({ id }) => id === version.id),
    )
  )
    return null
  const rates = manual ? modelRateCard(input.model.configuration!) : null
  if ((!active && rates) || !isDeepStrictEqual(active?.rates ?? null, rates)) {
    // Keep the active version immutable even when two saves share a clock millisecond.
    if (active?.effectiveFrom === now) return null
    past.push({ id: crypto.randomUUID(), effectiveFrom: now, rates })
  }
  return [...past, ...future].toSorted((left, right) =>
    left.effectiveFrom.localeCompare(right.effectiveFrom),
  )
}
