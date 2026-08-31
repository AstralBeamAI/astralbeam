import * as Schema from "effect/Schema"

export const UuidV7Schema = Schema.String.pipe(Schema.check(Schema.isUUID(7)))

export const LockVersionSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
)
