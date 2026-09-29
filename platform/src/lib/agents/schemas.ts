import { Schema } from "effect"

// Relative, because seed modules import this under a plain `deno run` without the `@/` alias.
import { NonEmptyStringSchema, UuidV7Schema } from "../schemas.ts"

const UUID_V7_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const AGENT_ID_PATTERN = new RegExp(`^agent_(${UUID_V7_PATTERN})_(${UUID_V7_PATTERN})$`)

/** The public `agent_<organizationId>_<id>` form of an agent's composite key. */
export const AgentIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(AGENT_ID_PATTERN, { message: "Enter a valid agent ID" })),
)

export const AgentNameSchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(100)),
)

export const AgentSystemPromptSchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isMaxLength(32_768)),
)

/** What an Organization member edits; the organization always comes from verified access. */
export const AgentFieldsSchema = Schema.Struct({
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  attachmentsEnabled: Schema.Boolean,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
})

export type AgentFields = typeof AgentFieldsSchema.Type

export function formatAgentId(key: { organizationId: string; id: string }): string {
  return `agent_${key.organizationId}_${key.id}`
}

/** A parsed organization ID identifies an agent's owner, but never authorizes access to it. */
export function parseAgentId(value: unknown): { organizationId: string; id: string } | null {
  const match = typeof value === "string" ? AGENT_ID_PATTERN.exec(value) : null
  return match ? { organizationId: match[1]!, id: match[2]! } : null
}
