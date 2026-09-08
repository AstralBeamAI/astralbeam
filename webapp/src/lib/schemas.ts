import * as Schema from "effect/Schema"

import { SLUG_PATTERN, SLUG_VALIDATION_MESSAGE } from "./slug.ts"

export const UuidV7Schema = Schema.String.pipe(Schema.check(Schema.isUUID(7)))

const AGENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const AGENT_ID_PATTERN = new RegExp(
  `^agent_(${AGENT_ID_UUID_PATTERN})_(${AGENT_ID_UUID_PATTERN})$`,
)

export function generateAgentSlug(input: { organizationId: string; id: string }): string {
  return `agent_${input.organizationId}_${input.id}`
}

/** Parsed organization IDs identify a resource, but never authorize access to it. */
export function parseAgentSlug(value: unknown): { organizationId: string; id: string } | null {
  if (typeof value !== "string") return null
  const match = AGENT_ID_PATTERN.exec(value)
  if (!match || match[0] !== value) return null
  return { organizationId: match[1]!, id: match[2]! }
}

export const AgentIdSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isPattern(AGENT_ID_PATTERN, { message: "Enter a valid agent ID" })),
)

export const SlugSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN, { message: SLUG_VALIDATION_MESSAGE })),
)

export const AgentNameSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(100)),
)

export const AgentSystemPromptSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(32_768)),
)

export const LockVersionSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
)

const ChatExternalIdSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(255)),
)

const ChatTenantSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.JsonObject),
})

const ChatTenantUserSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.JsonObject),
})

export const ChatAuthTokenPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    ver: Schema.Literal(4),
    iat: Schema.Int,
    exp: Schema.Int,
    iss: UuidV7Schema,
    aud: Schema.Literal("astralbeam"),
    user: ChatTenantUserSchema,
    tenant: ChatTenantSchema,
  }),
  [Schema.JsonObject],
)
