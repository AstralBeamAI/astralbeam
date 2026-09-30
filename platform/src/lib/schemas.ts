import * as Schema from "effect/Schema"

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

/** A UUIDv7 inside a composite public identifier such as `agent_<organizationId>_<id>`. */
export const UUID_V7_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

export const UuidV7Schema = Schema.String.pipe(
  Schema.check(Schema.isUUID(7, { message: "Must be a valid UUID v7" })),
)

export const LockVersionSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, { message: "Must be 0 or greater" }),
)
