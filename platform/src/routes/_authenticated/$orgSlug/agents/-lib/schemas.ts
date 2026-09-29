import { Schema } from "effect"

import { AgentFieldsSchema, AgentIdSchema } from "@/lib/agents/schemas"
import { LockVersionSchema, SlugSchema } from "@/lib/schemas"

/** Every agent function is addressed by the organization slug in the URL, never by an ID. */
export const OrganizationSlugInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

export const CreateAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  fields: AgentFieldsSchema,
})

export const UpdateAgentInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  agentId: AgentIdSchema,
  lockVersion: LockVersionSchema,
  fields: AgentFieldsSchema,
})

export const AgentVersionInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  agentId: AgentIdSchema,
  lockVersion: LockVersionSchema,
})

export const AgentIdInputSchema = Schema.Struct({
  organizationSlug: SlugSchema,
  agentId: AgentIdSchema,
})
