import { Schema } from "effect"

import { DisplayNameSchema, enumSchema, NonEmptyStringSchema, UuidV7Schema } from "../schemas.ts"

export const MODEL_PROVIDER_TYPES = ["openai", "anthropic", "opencode"] as const
export const ModelProviderTypeSchema = enumSchema(MODEL_PROVIDER_TYPES)
export type ModelProviderType = typeof ModelProviderTypeSchema.Type
export const ModelProviderApiSchema = enumSchema([
  "responses",
  "chat-completions",
  "anthropic-messages",
])
export type ModelProviderApi = typeof ModelProviderApiSchema.Type

export const ModelProviderApiKeySchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(16_384)),
)

export const ModelProviderBaseUrlSchema = Schema.String.pipe(
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

export const ProviderModelFieldsSchema = Schema.Struct({
  modelId: NonEmptyStringSchema.pipe(
    Schema.check(Schema.isTrimmed()),
    Schema.check(Schema.isMaxLength(256)),
  ),
  name: DisplayNameSchema,
  api: Schema.optionalKey(Schema.NullOr(ModelProviderApiSchema)),
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
      const supportsApi = (api: ModelProviderApi) =>
        provider.providerType === "opencode" ||
        (provider.providerType === "anthropic"
          ? api === "anthropic-messages"
          : api !== "anthropic-messages")
      if (!supportsApi(provider.api))
        return { path: ["api"], issue: "Select a supported API format for this provider" }
      const invalidModel = provider.models.findIndex(
        (model) => !supportsApi(model.api ?? provider.api),
      )
      if (invalidModel !== -1)
        return {
          path: ["models", invalidModel, "api"],
          issue: "Select a supported API format for this provider",
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
