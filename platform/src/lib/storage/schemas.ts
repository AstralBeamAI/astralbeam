import { Schema, SchemaGetter } from "effect"

import { NonEmptyStringSchema } from "@/lib/schemas"

export const StorageEndpointSchema = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    { message: "Use an HTTP(S) origin without credentials, path, query, or fragment" },
  ),
).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((url) => url.origin),
    encode: SchemaGetter.transform((value) => new URL(value)),
  }),
)

export const StorageConnectionSchema = Schema.Struct({
  endpoint: StorageEndpointSchema,
  region: NonEmptyStringSchema,
  bucket: NonEmptyStringSchema,
  accessKeyId: NonEmptyStringSchema,
  secretAccessKey: NonEmptyStringSchema,
  pathStyle: Schema.Boolean,
})

export type StorageConnection = typeof StorageConnectionSchema.Type
