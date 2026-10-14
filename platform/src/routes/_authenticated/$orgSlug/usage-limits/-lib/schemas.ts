import { Schema } from "effect"

import { SlugSchema } from "@/lib/organizations/slug"
import { LockVersionSchema } from "@/lib/schemas"
import { UsageLimitFieldsSchema, UsageLimitIdSchema } from "@/lib/usage-limits/schemas"

export const CreateUsageLimitInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  fields: UsageLimitFieldsSchema,
})

export const UpdateUsageLimitInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  usageLimitId: UsageLimitIdSchema,
  lockVersion: LockVersionSchema,
  fields: UsageLimitFieldsSchema,
})

export const UsageLimitVersionInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  usageLimitId: UsageLimitIdSchema,
  lockVersion: LockVersionSchema,
})

export const SetUsageLimitEnabledInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  usageLimitId: UsageLimitIdSchema,
  lockVersion: LockVersionSchema,
  enabled: Schema.Boolean,
})

export const UsageLimitIdInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  usageLimitId: UsageLimitIdSchema,
})
