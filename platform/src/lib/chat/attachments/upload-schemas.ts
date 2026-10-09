import { Schema } from "effect"
import { ApiUuidSchema } from "../../tenants/schemas.ts"
import { NonEmptyStringSchema } from "../../schemas.ts"

export const UPLOAD_PART_BYTES = 8 * 1024 * 1024
export const UploadInputSchema = Schema.Struct({
  filename: NonEmptyStringSchema.check(
    Schema.isMaxCodePoints(120),
    Schema.makeFilter((value) => !value.includes("\0"), {
      message: "Filename must not contain NUL characters.",
      toJsonSchema: () => ({ pattern: "^[^\\u0000]*$" }),
    }),
  ),
  contentType: NonEmptyStringSchema.check(Schema.isMaxCodePoints(255)),
  byteSize: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(20 * 1024 * 1024)),
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  agentId: Schema.optionalKey(Schema.String),
})
  .pipe(
    Schema.encodeKeys({ contentType: "content_type", byteSize: "byte_size", agentId: "agent_id" }),
  )
  .annotate({ identifier: "ChatUploadInput" })
export const UploadStatusSchema = Schema.Struct({
  id: ApiUuidSchema,
  status: Schema.Literals([
    "preparing",
    "pending",
    "completing",
    "completed",
    "cancelled",
    "expired",
  ]),
  filename: Schema.String,
  contentType: Schema.String,
  byteSize: Schema.Int,
  sha256: Schema.String,
  expiresAt: Schema.String,
  partSize: Schema.Int,
  parts: Schema.Array(Schema.Struct({ number: Schema.Int, size: Schema.Int })),
  fileId: Schema.NullOr(ApiUuidSchema),
})
  .pipe(
    Schema.encodeKeys({
      contentType: "content_type",
      byteSize: "byte_size",
      expiresAt: "expires_at",
      partSize: "part_size",
      fileId: "file_id",
    }),
  )
  .annotate({ identifier: "ChatUpload" })
export type UploadStatus = typeof UploadStatusSchema.Type
