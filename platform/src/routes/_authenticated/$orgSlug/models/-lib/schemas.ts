import { Schema } from "effect"

import { ModelProviderFieldsSchema } from "@/lib/model-providers/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

export const SaveModelProviderInputSchema = ModelProviderFieldsSchema.mapFields(
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
