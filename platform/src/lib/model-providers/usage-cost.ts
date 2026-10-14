import { BigDecimal } from "effect"

import type { ModelConfiguration } from "./schemas.ts"

/** The token counts a model call reports. Prompt tokens include cache reads and writes. */
export interface ModelCallUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly promptTokensDetails?:
    | { readonly cachedTokens?: number | undefined; readonly cacheWriteTokens?: number | undefined }
    | undefined
}

const perMillion = BigDecimal.fromNumberUnsafe(1_000_000)

/**
 * The US dollar cost of one model call at a configuration's rates, as a decimal string. Context
 * tiers price the whole call by its prompt size, and missing cache rates fall back to the input rate.
 */
export function modelUsageCost(configuration: ModelConfiguration, usage: ModelCallUsage): string {
  const prices =
    configuration.contextTiers.findLast((tier) => usage.promptTokens > tier.aboveInputTokens)
      ?.prices ?? configuration.prices
  const cacheRead = usage.promptTokensDetails?.cachedTokens ?? 0
  const cacheWrite = usage.promptTokensDetails?.cacheWriteTokens ?? 0
  const charges: [number, string][] = [
    [Math.max(0, usage.promptTokens - cacheRead - cacheWrite), prices.inputPerMillion],
    [cacheRead, prices.cacheReadPerMillion ?? prices.inputPerMillion],
    [cacheWrite, prices.cacheWritePerMillion ?? prices.inputPerMillion],
    [usage.completionTokens, prices.outputPerMillion],
  ]
  const total = charges.reduce(
    (sum, [tokens, rate]) =>
      BigDecimal.sum(
        sum,
        BigDecimal.multiply(BigDecimal.fromNumberUnsafe(tokens), BigDecimal.fromStringUnsafe(rate)),
      ),
    BigDecimal.fromNumberUnsafe(0),
  )
  return BigDecimal.format(BigDecimal.divideUnsafe(total, perMillion))
}
