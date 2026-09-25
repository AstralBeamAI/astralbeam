import * as Schema from "effect/Schema"

import {
  AgentIdSchema,
  AgentNameSchema,
  AgentSystemPromptSchema,
  LockVersionSchema,
  SlugSchema,
  UuidV7Schema,
} from "@/lib/schemas"

/** Every agent function is addressed by the organization slug in the URL, never by an ID. */
export const OrganizationSlugInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

const AgentFieldsSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  attachmentsEnabled: Schema.Boolean,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
})

export const CreateAgentInputSchema = AgentFieldsSchema

export const UpdateAgentInputSchema = Schema.Struct({
  ...AgentFieldsSchema.fields,
  id: AgentIdSchema,
  lockVersion: LockVersionSchema,
})

export const DeleteAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: AgentIdSchema,
  lockVersion: LockVersionSchema,
})

export const SetDefaultAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: AgentIdSchema,
})

export const AgentIdInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  agentId: AgentIdSchema,
})
