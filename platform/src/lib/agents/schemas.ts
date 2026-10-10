import { Schema } from "effect"

// Relative, because seed modules import this under a plain `deno run` without the `@/` alias.
import {
  DisplayNameSchema,
  NonEmptyStringSchema,
  UUID_V7_PATTERN,
  UuidV7Schema,
} from "../schemas.ts"

const AGENT_ID_PATTERN = new RegExp(`^agent_(${UUID_V7_PATTERN})_(${UUID_V7_PATTERN})$`)

/** The public `agent_<organizationId>_<id>` form of an agent's composite key. */
export const AgentIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(AGENT_ID_PATTERN, { message: "Enter a valid agent ID" })),
)

export const AgentNameSchema = DisplayNameSchema

export const AgentSystemPromptSchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isMaxLength(32_768)),
)

/** What an Organization member edits. The organization always comes from verified access. */
export const AgentFieldsSchema = Schema.Struct({
  name: AgentNameSchema,
  systemPrompt: AgentSystemPromptSchema,
  attachmentsEnabled: Schema.Boolean,
  webAccessEnabled: Schema.Boolean,
  sandboxProviderId: Schema.NullOr(UuidV7Schema),
  modelIds: Schema.optionalKey(
    Schema.Array(UuidV7Schema).pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(100)),
      Schema.check(
        Schema.makeFilter((ids) => new Set(ids).size === ids.length, {
          message: "Select each model only once",
        }),
      ),
    ),
  ),
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
