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

const ModelRateCardSchema = Schema.Struct({
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
})

export type ModelRateCard = typeof ModelRateCardSchema.Type

export const ModelLimitsSchema = Schema.Struct({
  maxInputTokens: Schema.NullOr(modelTokenBoundSchema),
  contextWindowTokens: Schema.NullOr(modelTokenBoundSchema),
  maxOutputTokens: modelTokenBoundSchema,
  outputCap: modelTokenBoundSchema,
}).check(
  Schema.makeFilter((limits) => {
    if (limits.maxInputTokens === null && limits.contextWindowTokens === null)
      return { path: ["maxInputTokens"], issue: "Configure an input or context token limit" }
    if (limits.outputCap > limits.maxOutputTokens)
      return { path: ["outputCap"], issue: "Output cap exceeds the configured output maximum" }
    if (limits.contextWindowTokens !== null && limits.outputCap >= limits.contextWindowTokens)
      return { path: ["outputCap"], issue: "Leave room for input within the context window" }
    return undefined
  }),
)
export type ModelLimits = typeof ModelLimitsSchema.Type

export const ModelConfigurationSchema = ModelLimitsSchema.mapFields(
  (fields) => ({ ...fields, ...ModelRateCardSchema.fields }),
  { unsafePreserveChecks: true },
).check(
  Schema.makeFilter((configuration) => {
    if (configuration.pricingSource.kind === "manual" && configuration.contextTiers.length > 0)
      return {
        path: ["contextTiers"],
        issue: "Manual overrides use flat prices without context tiers",
      }
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
export type ModelConfiguration = typeof ModelConfigurationSchema.Type

const modelPriceInstant = Schema.String.check(
  Schema.isPattern(/^\d{4}-/),
  Schema.makeFilter((value) => {
    const date = new Date(value)
    return !Number.isNaN(date.getTime()) && date.toISOString() === value
  }),
)
const ModelManualPricePolicySchema = Schema.Struct({
  kind: Schema.Literal("manual"),
  prices: ModelTokenPricesSchema,
})
export const ModelPricePolicySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("catalog") }),
  ModelManualPricePolicySchema,
])
const ModelPriceVersionSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  effectiveFrom: modelPriceInstant,
  policy: ModelPricePolicySchema,
})
export type ModelPriceVersion = typeof ModelPriceVersionSchema.Type
export const ModelPriceHistorySchema = Schema.Array(ModelPriceVersionSchema).check(
  Schema.makeFilter(
    (versions) =>
      new Set(versions.map(({ effectiveFrom }) => effectiveFrom)).size === versions.length &&
      new Set(versions.map(({ id }) => id)).size === versions.length,
  ),
)
const ModelScheduledPriceSchema = Schema.Struct({
  ...ModelPriceVersionSchema.fields,
  policy: ModelManualPricePolicySchema,
})
export type ModelScheduledPrice = typeof ModelScheduledPriceSchema.Type
const ModelScheduledPricesSchema = Schema.Array(ModelScheduledPriceSchema).check(
  Schema.isMaxLength(32),
  Schema.makeFilter(
    (versions) =>
      new Set(versions.map(({ id }) => id)).size === versions.length &&
      new Set(versions.map(({ effectiveFrom }) => effectiveFrom)).size === versions.length,
  ),
)
const ModelPricingChangeSchema = Schema.Struct({
  expectedVersionId: Schema.NullOr(Schema.String.check(Schema.isUUID())),
  policy: Schema.optionalKey(ModelPricePolicySchema),
  scheduledPrices: Schema.optionalKey(ModelScheduledPricesSchema),
})
export type ModelPricingChange = typeof ModelPricingChangeSchema.Type

export function modelInputAllowance(configuration: ModelConfiguration) {
  return Math.min(
    configuration.maxInputTokens ?? Infinity,
    configuration.contextWindowTokens === null
      ? Infinity
      : configuration.contextWindowTokens - configuration.outputCap,
  )
}

const MODEL_PROVIDER_TYPES = ["openai", "anthropic", "google", "xai", "openrouter"] as const
const ModelProviderTypeSchema = enumSchema(MODEL_PROVIDER_TYPES)
export type ModelProviderType = typeof ModelProviderTypeSchema.Type
const ModelProviderApiSchema = enumSchema([
  "responses",
  "chat-completions",
  "anthropic-messages",
  "gemini-generate-content",
])
export type ModelProviderApi = typeof ModelProviderApiSchema.Type

export const ModelRequestSnapshotSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  startedAt: modelPriceInstant,
  providerId: Schema.String,
  providerType: ModelProviderTypeSchema,
  protocol: ModelProviderApiSchema,
  modelId: Schema.String,
  rates: Schema.NullOr(ModelRateCardSchema),
  usage: Schema.optionalKey(Schema.JsonObject),
  costUsd: Schema.optionalKey(
    Schema.NullOr(Schema.String.check(Schema.isPattern(/^-?\d+(?:\.\d+)?$/))),
  ),
})
export type ModelRequestSnapshot = typeof ModelRequestSnapshotSchema.Type

const modelProviderApis: Record<ModelProviderType, readonly ModelProviderApi[]> = {
  openai: ["responses", "chat-completions"],
  anthropic: ["anthropic-messages"],
  google: ["gemini-generate-content"],
  xai: ["responses"],
  openrouter: ["chat-completions"],
}

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
  configuration: Schema.optionalKey(Schema.NullOr(ModelConfigurationSchema)),
  priceVersionId: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isUUID()))),
  scheduledPrices: Schema.optionalKey(ModelScheduledPricesSchema),
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
      if (!modelProviderApis[provider.providerType].includes(provider.api))
        return { path: ["api"], issue: "Select a supported API format for this provider" }
      // The Anthropic SDK appends /v1/messages itself. https://docs.anthropic.com/en/api/messages
      if (provider.api === "anthropic-messages" && /\/v1\/?$/.test(provider.baseUrl))
        return {
          path: ["baseUrl"],
          issue: "Remove /v1 from the Anthropic API URL. The client adds it to each request",
        }
      // The Gemini SDK appends /v1beta/models itself. https://ai.google.dev/gemini-api/docs/api-versions
      if (provider.api === "gemini-generate-content" && /\/v1\w*\/?$/.test(provider.baseUrl))
        return {
          path: ["baseUrl"],
          issue:
            "Remove the API version from the Gemini API URL. The client adds it to each request",
        }
      return undefined
    }),
  ),
)

export const ModelProviderCredentialsPayloadSchema = Schema.Struct({
  organizationId: UuidV7Schema,
  modelProviderId: UuidV7Schema,
  providerType: ModelProviderTypeSchema,
  apiKey: ModelProviderApiKeySchema,
})

export const ModelProviderWriteFieldsSchema = ModelProviderFieldsSchema.mapFields(
  (fields) => ({
    ...fields,
    models: Schema.Array(
      Schema.Struct({
        modelId: ProviderModelFieldsSchema.fields.modelId,
        name: DisplayNameSchema,
        configuration: Schema.optionalKey(Schema.NullOr(ModelLimitsSchema)),
        pricing: Schema.optionalKey(ModelPricingChangeSchema),
      }),
    ).check(
      Schema.isMaxLength(100),
      Schema.makeFilter(
        (models) => new Set(models.map(({ modelId }) => modelId)).size === models.length,
      ),
    ),
  }),
  { unsafePreserveChecks: true },
)
export type ModelProviderWriteFields = typeof ModelProviderWriteFieldsSchema.Type
