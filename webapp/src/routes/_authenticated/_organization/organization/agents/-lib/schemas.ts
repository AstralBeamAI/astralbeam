import * as Schema from "effect/Schema"

import {
  AgentNameSchema,
  AgentSystemPromptSchema,
  LockVersionSchema,
  SlugSchema,
  UuidV7Schema,
} from "@/lib/schemas"

export const CreateOrganizationAgentInputSchema = Schema.Struct({
  slug: SlugSchema,
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  attachmentsEnabled: Schema.Boolean,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
})

export const UpdateOrganizationAgentInputSchema = Schema.Struct({
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  attachmentsEnabled: Schema.Boolean,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
})

export const DeleteOrganizationAgentInputSchema = Schema.Struct({
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const SetOrganizationDefaultAgentInputSchema = Schema.Struct({ id: UuidV7Schema })
