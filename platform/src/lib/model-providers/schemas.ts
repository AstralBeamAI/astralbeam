import { Schema } from "effect"

import { DisplayNameSchema, enumSchema, NonEmptyStringSchema, UuidV7Schema } from "../schemas.ts"

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

const MODEL_PROVIDER_TYPES = ["openai", "anthropic", "openrouter"] as const
const ModelProviderTypeSchema = enumSchema(MODEL_PROVIDER_TYPES)
export type ModelProviderType = typeof ModelProviderTypeSchema.Type
const ModelProviderApiSchema = enumSchema(["responses", "chat-completions", "anthropic-messages"])
export type ModelProviderApi = typeof ModelProviderApiSchema.Type

const ModelProviderApiKeySchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(16_384)),
)

const ModelProviderBaseUrlSchema = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2048)),
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          const url = new URL(value)
          return (
            ["https:", "http:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          )
        } catch {
          return false
        }
      },
      { message: "Enter an HTTP or HTTPS API URL without credentials, query, or fragment" },
    ),
  ),
)

const ProviderModelFieldsSchema = Schema.Struct({
  modelId: NonEmptyStringSchema.pipe(
    Schema.check(Schema.isTrimmed()),
    Schema.check(Schema.isMaxLength(256)),
  ),
  name: DisplayNameSchema,
  usageConfiguration: Schema.optionalKey(Schema.NullOr(ModelUsageConfigurationSchema)),
})

export type ProviderModelFields = typeof ProviderModelFieldsSchema.Type

export const ModelProviderFieldsSchema = Schema.Struct({
  name: DisplayNameSchema,
  providerType: ModelProviderTypeSchema,
  api: ModelProviderApiSchema,
  baseUrl: ModelProviderBaseUrlSchema,
  apiKey: Schema.NullOr(ModelProviderApiKeySchema),
  models: Schema.Array(ProviderModelFieldsSchema).pipe(
    Schema.check(Schema.isMaxLength(100)),
    Schema.check(
      Schema.makeFilter(
        (models) => new Set(models.map((model) => model.modelId)).size === models.length,
        { message: "Select each model only once" },
      ),
    ),
  ),
}).pipe(
  Schema.check(
    Schema.makeFilter((provider) => {
      const supported =
        provider.providerType === "anthropic"
          ? provider.api === "anthropic-messages"
          : provider.providerType === "openrouter"
            ? provider.api === "chat-completions"
            : provider.api !== "anthropic-messages"
      if (!supported)
        return { path: ["api"], issue: "Select a supported API format for this provider" }
      // The Anthropic SDK appends /v1/messages itself. https://docs.anthropic.com/en/api/messages
      if (provider.api === "anthropic-messages" && /\/v1\/?$/.test(provider.baseUrl))
        return {
          path: ["baseUrl"],
          issue: "Remove /v1 from the Anthropic API URL. The client adds it to each request",
        }
      return undefined
    }),
  ),
)
export type ModelProviderFields = typeof ModelProviderFieldsSchema.Type

export const ModelProviderCredentialsPayloadSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  modelProviderId: UuidV7Schema,
  providerType: ModelProviderTypeSchema,
  apiKey: ModelProviderApiKeySchema,
})
