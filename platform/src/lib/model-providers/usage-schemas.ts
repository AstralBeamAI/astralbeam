import { Schema } from "effect"

const modelTokenBoundSchema = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100_000_000),
)

const modelPriceSchema = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,12})?$/, {
    message: "Enter a non-negative USD price with at most 12 decimal places",
  }),
)

const ModelTokenPricesSchema = Schema.Struct({
  inputPerMillion: modelPriceSchema,
  outputPerMillion: modelPriceSchema,
  cacheReadPerMillion: Schema.optionalKey(modelPriceSchema),
  cacheWritePerMillion: Schema.optionalKey(modelPriceSchema),
  cacheWrite1hPerMillion: Schema.optionalKey(modelPriceSchema),
})

export const ModelUsageConfigurationSchema = Schema.Struct({
  currency: Schema.Literal("USD"),
  pricingSource: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("catalog"), modelId: Schema.String }),
    Schema.Struct({ kind: Schema.Literal("manual") }),
  ]),
  prices: ModelTokenPricesSchema,
  contextTiers: Schema.Array(
    Schema.Struct({
      aboveInputTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      prices: ModelTokenPricesSchema,
    }),
  ).check(Schema.isMaxLength(32)),
  maxInputTokens: Schema.NullOr(modelTokenBoundSchema),
  contextWindowTokens: Schema.NullOr(modelTokenBoundSchema),
  maxOutputTokens: modelTokenBoundSchema,
  outputCap: modelTokenBoundSchema,
}).check(
  Schema.makeFilter((configuration) => {
    if (configuration.pricingSource.kind === "manual" && configuration.contextTiers.length > 0)
      return {
        path: ["contextTiers"],
        issue: "Manual overrides use flat prices without context tiers",
      }
    if (configuration.maxInputTokens === null && configuration.contextWindowTokens === null)
      return { path: ["maxInputTokens"], issue: "Configure an input or context token limit" }
    if (configuration.outputCap > configuration.maxOutputTokens)
      return { path: ["outputCap"], issue: "Output cap exceeds the configured output maximum" }
    if (
      configuration.contextWindowTokens !== null &&
      configuration.outputCap >= configuration.contextWindowTokens
    )
      return { path: ["outputCap"], issue: "Leave room for input within the context window" }
    if (
      configuration.contextTiers.some(
        (tier, index, tiers) =>
          index > 0 && tier.aboveInputTokens <= tiers[index - 1]!.aboveInputTokens,
      )
    )
      return { path: ["contextTiers"], issue: "Context tiers must have increasing thresholds" }
    return undefined
  }),
)

export type ModelUsageConfiguration = typeof ModelUsageConfigurationSchema.Type

export function modelInputAllowance(configuration: ModelUsageConfiguration) {
  return Math.min(
    configuration.maxInputTokens ?? Infinity,
    configuration.contextWindowTokens === null
      ? Infinity
      : configuration.contextWindowTokens - configuration.outputCap,
  )
}
