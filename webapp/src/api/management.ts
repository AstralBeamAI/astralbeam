import { Schema } from "effect"
import { UuidV7Schema } from "../lib/schemas.ts"

export const TenantExternalIdSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
).annotate({
  description:
    "Your stable external identity. Exact and case-sensitive; whitespace is preserved. Immutable after creation.",
})

const metadata = Schema.JsonObject.annotate({
  description: "Customer-defined JSON object; keys are preserved.",
})
const name = Schema.NullOr(Schema.String)

export const TenantRecordSchema = Schema.Struct({
  id: UuidV7Schema,
  externalId: Schema.String,
  name,
  metadata,
  createdAt: Schema.DateFromString.pipe(Schema.annotateEncoded({ format: "date-time" })),
  updatedAt: Schema.DateFromString.pipe(Schema.annotateEncoded({ format: "date-time" })),
})

export const TenantUserRecordSchema = Schema.Struct({
  ...TenantRecordSchema.fields,
  tenantId: UuidV7Schema,
  admin: Schema.Boolean,
})

const tenantMutableFields = {
  name: Schema.optionalKey(
    name.annotate({ description: "Defaults to null on creation. Send null to clear the name." }),
  ),
  metadata: Schema.optionalKey(
    metadata.annotate({
      description:
        "Customer-defined JSON object; keys are preserved. Defaults to {} on creation. Updates replace the entire object.",
    }),
  ),
}
const tenantUserMutableFields = {
  ...tenantMutableFields,
  admin: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Defaults to false on creation. Stored admin does not change signed JWT authority.",
    }),
  ),
}
const writeOptions = { parseOptions: { onExcessProperty: "error" as const } }

export const TenantWriteSchema = Schema.Struct({
  externalId: TenantExternalIdSchema,
  ...tenantMutableFields,
}).annotate(writeOptions)

export const TenantUserWriteSchema = Schema.Struct({
  externalId: TenantExternalIdSchema,
  ...tenantUserMutableFields,
}).annotate(writeOptions)

export const TenantPatchSchema = Schema.Struct(tenantMutableFields).check(
  Schema.isMinProperties(1),
).annotate(writeOptions)

export const TenantUserPatchSchema = Schema.Struct(tenantUserMutableFields).check(
  Schema.isMinProperties(1),
).annotate(writeOptions)
