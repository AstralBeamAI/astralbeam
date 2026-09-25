import { Schema, Tuple } from "effect"

import {
  SandboxProviderConfigurationSchema,
  SandboxProviderNameSchema,
} from "@/lib/sandbox/schemas"
import { LockVersionSchema, SlugSchema, UuidV7Schema } from "@/lib/schemas"

/** Every sandbox function is addressed by the organization slug in the URL, never by an ID. */
export const OrganizationSlugInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

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
