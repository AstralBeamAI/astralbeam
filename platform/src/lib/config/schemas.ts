import { Result, Schema, SchemaGetter } from "effect"

import { enumSchema } from "../schemas.ts"

const BooleanSettingLiteralSchema = enumSchema(["false", "true"])
export const BooleanSettingSchema = Schema.Union([
  BooleanSettingLiteralSchema,
  Schema.Boolean.pipe(
    Schema.decodeTo(BooleanSettingLiteralSchema, {
      decode: SchemaGetter.transform((value) => (value ? "true" : "false")),
      encode: SchemaGetter.transform((value) => value === "true"),
    }),
  ),
])

// JSON-encoded environment values and ordinary unquoted shell strings are both supported.
export function parseEnvironmentConfigValue(value: string): unknown {
  return Result.getOrElse(
    Result.try(() => JSON.parse(value) as unknown),
    () => value,
  )
}
