import * as Schema from "effect/Schema"

import { SLUG_PATTERN, SLUG_VALIDATION_MESSAGE } from "./organizations/slug.ts"

export const validationParseOptions = { errors: "all", reportInput: false } as const

export const strictParseOptions = {
  ...validationParseOptions,
  onExcessProperty: "error",
} as const

export function toValidationSchema<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  parseOptions = validationParseOptions,
) {
  return Schema.toStandardSchemaV1(schema, { parseOptions })
}

export const NonEmptyStringSchema = Schema.String.check(
  Schema.isMinLength(1, { message: "Must not be empty" }),
)

/** A trimmed display name, such as an organization's or an agent's. */
export const DisplayNameSchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(100)),
)

// Better Auth validates addresses with Zod's `z.email()`, so a value this accepts it accepts too.
// https://zod.dev/api#emails
export const EmailAddressSchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^(?!\.)(?!.+\.\.)[\w'+.-]*[\w+-]@(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/i, {
      message: "Must be a valid email address",
    }),
    Schema.isMaxLength(254),
  ),
)

export function enumSchema<const Values extends readonly string[]>(values: Values) {
  return Schema.Literals(values).annotate({
    message: `Must be ${new Intl.ListFormat("en", { type: "disjunction" }).format(values)}`,
  })
}

export const UuidV7Schema = Schema.String.pipe(
  Schema.check(Schema.isUUID(7, { message: "Must be a valid UUID v7" })),
)

export const SlugSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN, { message: SLUG_VALIDATION_MESSAGE })),
)

export const OPENAI_API_KEY_VALIDATION_MESSAGE =
  "Enter an OpenAI API key, which starts with 'sk-' and contains no spaces"

// Shape only: every key OpenAI issues is one `sk-` token, so a pasted env line or project ID is
// refused here instead of failing every chat run. https://platform.openai.com/docs/api-reference/authentication
export const OpenaiApiKeySchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^sk-[\w-]{16,500}$/, {
      message: OPENAI_API_KEY_VALIDATION_MESSAGE,
    }),
  ),
)

export const isValidOpenaiApiKey = Schema.is(OpenaiApiKeySchema)

export const LockVersionSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, { message: "Must be 0 or greater" }),
)

const ChatExternalIdSchema = NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(255)))

const ChatTenantSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.JsonObject),
})

const ChatTenantUserSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.JsonObject),
})

export const ChatAuthTokenPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    ver: Schema.Literal(4),
    iat: Schema.Int,
    exp: Schema.Int,
    iss: UuidV7Schema,
    aud: Schema.Literal("astralbeam"),
    user: ChatTenantUserSchema,
    tenant: ChatTenantSchema,
  }),
  [Schema.JsonObject],
)
