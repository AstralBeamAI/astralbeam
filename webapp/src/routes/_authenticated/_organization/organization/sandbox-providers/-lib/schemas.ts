import * as Schema from "effect/Schema"

import { SandboxProviderIdSchema, SandboxProviderNameSchema } from "@/lib/sandbox/schemas"
import { LockVersionSchema, UuidV7Schema } from "@/lib/schemas"

export const OrganizationSandboxSaveInputSchema = Schema.Struct({
  name: SandboxProviderNameSchema,
  providerType: SandboxProviderIdSchema,
  options: Schema.Json,
  credentials: Schema.Json,
  id: Schema.NullOr(UuidV7Schema),
  lockVersion: Schema.NullOr(LockVersionSchema),
})

export const OrganizationSandboxExistingInputSchema = Schema.Struct({
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})
