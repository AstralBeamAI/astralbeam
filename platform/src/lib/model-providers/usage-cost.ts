import { BigDecimal, Schema } from "effect"

import type { ModelConfiguration } from "./schemas.ts"

export const ModelRequestUsageSchema = Schema.Struct({
  promptTokens: Schema.Number,
  completionTokens: Schema.Number,
  promptTokensDetails: Schema.optional(
    Schema.Struct({
      cachedTokens: Schema.optional(Schema.Number),
      cacheWriteTokens: Schema.optional(Schema.Number),
    }),
  ),
})

/** The token counts a model call reports. Prompt tokens include cache reads and writes. */
export type ModelCallUsage = typeof ModelRequestUsageSchema.Type & {
  readonly providerUsageDetails?: Readonly<Record<string, unknown>> | undefined
}

const perMillion = BigDecimal.fromNumberUnsafe(1_000_000)

/**
 * The US dollar token cost at a configuration's rates, as a decimal string. Context tiers price each
 * underlying request by its prompt size, and missing cache rates fall back to the input rate.
 */
export function modelUsageCost(configuration: ModelConfiguration, usage: ModelCallUsage): string {
  const requests = usage.providerUsageDetails?.requestUsage
  if (Schema.is(Schema.Array(ModelRequestUsageSchema))(requests)) {
    return BigDecimal.format(
      requests.reduce(
        (sum, request) =>
          BigDecimal.sum(sum, BigDecimal.fromStringUnsafe(modelUsageCost(configuration, request))),
        BigDecimal.fromNumberUnsafe(0),
      ),
    )
  }
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
