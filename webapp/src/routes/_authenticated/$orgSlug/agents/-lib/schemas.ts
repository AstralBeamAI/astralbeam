import * as Schema from "effect/Schema"

import {
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

export const CreateAgentInputSchema = Schema.Struct({
  ...AgentFieldsSchema.fields,
  slug: SlugSchema,
})

export const UpdateAgentInputSchema = Schema.Struct({
  ...AgentFieldsSchema.fields,
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const DeleteAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: UuidV7Schema,
  lockVersion: LockVersionSchema,
})

export const SetDefaultAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  id: UuidV7Schema,
})

export const CheckAgentSlugInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  slug: SlugSchema,
})

export const AgentSlugInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  agentSlug: SlugSchema,
})
