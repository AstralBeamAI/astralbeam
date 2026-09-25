import * as Schema from "effect/Schema"

import { SandboxProviderIdSchema, SandboxProviderNameSchema } from "@/lib/sandbox/schemas"
import { LockVersionSchema, SlugSchema, UuidV7Schema } from "@/lib/schemas"

/** Every sandbox function is addressed by the organization slug in the URL, never by an ID. */
export const OrganizationSlugInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

export const SaveSandboxProviderInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
  options: Schema.Json,
  credentials: Schema.Json,
  id: Schema.NullOr(UuidV7Schema),
  lockVersion: Schema.NullOr(LockVersionSchema),
})

export const SandboxProviderInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const SandboxProviderIdInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  sandboxProviderId: UuidV7Schema,
})
