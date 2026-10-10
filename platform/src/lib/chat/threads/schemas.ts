import { Schema } from "effect"
import { LockVersionSchema, NonEmptyStringSchema } from "../../schemas.ts"
import { ApiUuidSchema } from "../../tenants/schemas.ts"

export const ChatSubmissionReceiptSchema = Schema.Struct({
  threadId: ApiUuidSchema,
  acceptedMessageId: ApiUuidSchema,
  threadVersion: LockVersionSchema,
})

const ChatParticipantRoleSchema = Schema.Literals(["viewer", "member", "manager"])
export type ChatParticipantRole = typeof ChatParticipantRoleSchema.Type

const ChatPartSchema = Schema.StructWithRest(
  Schema.Struct({ id: NonEmptyStringSchema, type: NonEmptyStringSchema }),
  [Schema.JsonObject],
)

export const ChatToolDecisionSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    type: Schema.Literal("tool-call"),
    toolCallId: Schema.String,
    name: Schema.String,
    arguments: Schema.String,
    executionLocation: Schema.Literals(["server_api", "sandbox", "browser", "provider"]),
    targets: Schema.Array(
      Schema.Struct({
        id: Schema.String.check(Schema.isUUID()),
        tenantUserId: Schema.optional(Schema.String.check(Schema.isUUID())),
        clientId: Schema.optional(Schema.String),
      }),
    ).check(
      Schema.makeFilter(
        (targets) => new Set(targets.map((target) => target.id)).size === targets.length,
      ),
    ),
  }),
  [Schema.JsonObject],
).check(
  Schema.makeFilter((part) =>
    part.executionLocation === "provider" ? part.targets.length === 0 : part.targets.length > 0,
  ),
)

export const ChatMessagePayloadSchema = Schema.Struct({
  version: Schema.Literal(1),
  parts: Schema.Array(ChatPartSchema).check(
    Schema.makeFilter((parts) => new Set(parts.map((part) => part.id)).size === parts.length),
  ),
  tools: Schema.optional(Schema.Array(Schema.JsonObject)),
  modelMessages: Schema.optional(Schema.Array(Schema.JsonObject)),
  provenance: Schema.optional(Schema.JsonObject),
  invocationId: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
})
export type ChatMessagePayload = typeof ChatMessagePayloadSchema.Type

export interface ChatThreadScope {
  readonly organizationId: string
  readonly tenantId: string
  readonly tenantUserId: string
}

export interface ChatWriterClaim {
  readonly scope: ChatThreadScope
  readonly threadId: string
  readonly assistantMessageId: string
  readonly inputMessageId: string
  readonly invocationId: string
}

export interface ChatToolResolution {
  readonly assistantMessageId: string
  readonly toolPartId: string
  readonly responseTargetId: string
  readonly payload: ChatMessagePayload
}
