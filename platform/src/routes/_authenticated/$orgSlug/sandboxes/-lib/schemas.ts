import { Schema, Tuple } from "effect"

import {
  SandboxProviderConfigurationSchema,
  SandboxProviderNameSchema,
} from "@/lib/sandboxes/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

export const SaveSandboxProviderInputSchema = SandboxProviderConfigurationSchema.mapMembers(
  Tuple.map(
    Schema.fieldsAssign({
      organizationSlug: SlugSchema,
      name: SandboxProviderNameSchema,
      id: Schema.NullOr(UuidV7Schema),
      lockVersion: Schema.NullOr(LockVersionSchema),
    }),
  ),
)

export const SandboxProviderInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const SandboxProviderIdInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  sandboxProviderId: UuidV7Schema,
})
