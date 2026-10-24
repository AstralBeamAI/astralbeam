import { Schema } from "effect"

import {
  ModelProviderFieldsSchema,
  ModelProviderWriteFieldsSchema,
} from "@/lib/model-providers/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

export const ModelProviderFormInputSchema = ModelProviderFieldsSchema.mapFields(
  (fields) => ({
    ...fields,
    organizationSlug: SlugSchema,
    id: Schema.NullOr(UuidV7Schema),
    lockVersion: Schema.NullOr(LockVersionSchema),
  }),
  { unsafePreserveChecks: true },
)

export const SaveModelProviderInputSchema = ModelProviderWriteFieldsSchema.mapFields(
  (fields) => ({
    ...fields,
    organizationSlug: SlugSchema,
    id: Schema.NullOr(UuidV7Schema),
    lockVersion: Schema.NullOr(LockVersionSchema),
  }),
  { unsafePreserveChecks: true },
)

export const ModelProviderVersionInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const ModelProviderPageInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: Schema.NullOr(UuidV7Schema),
})

export const TestModelProviderInputSchema = Schema.Struct({
  ...ModelProviderVersionInputSchema.fields,
  modelId: UuidV7Schema,
})
