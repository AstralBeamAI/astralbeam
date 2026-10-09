import { Schema, SchemaGetter } from "effect"

import { NonEmptyStringSchema } from "../schemas.ts"

export const StorageEndpointSchema = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    { message: "Use an HTTP(S) URL without credentials, query, or fragment" },
  ),
).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((url) => url.origin + url.pathname.replace(/\/+$/, "")),
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

const StorageDestinationSchema = Schema.Struct({
  endpoint: StorageEndpointSchema,
  region: NonEmptyStringSchema,
  bucket: NonEmptyStringSchema,
  pathStyle: Schema.Boolean,
})

export const StoredStorageDestinationSchema = Schema.fromJsonString(StorageDestinationSchema)
