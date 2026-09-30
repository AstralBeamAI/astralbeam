import { Schema } from "effect"

import { AgentFieldsSchema, AgentIdSchema } from "@/lib/agents/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { LockVersionSchema } from "@/lib/schemas"

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
