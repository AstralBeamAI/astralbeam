import { Schema } from "effect"
import { ApiUuidSchema } from "../../lib/tenants/schemas.ts"

const boundedChatJson = Schema.makeFilter(
  (value: unknown) => JSON.stringify(value).length <= 32 * 1024 * 1024,
)

export const ChatMessageMetadataSchema = Schema.Struct({
  version: Schema.Literal(1),
  tools: Schema.optional(Schema.Array(Schema.JsonObject)),
  modelMessages: Schema.optional(Schema.Array(Schema.JsonObject)),
  invocationId: Schema.optional(Schema.String),
  provenance: Schema.optional(
    Schema.Struct({
      agentId: Schema.optional(Schema.NullOr(Schema.String)),
      initiatorTenantUserId: Schema.optional(ApiUuidSchema),
      clientId: Schema.optional(ApiUuidSchema),
      providerId: Schema.optional(Schema.String),
      providerType: Schema.optional(Schema.String),
      protocol: Schema.optional(Schema.String),
      modelId: Schema.optional(Schema.String),
      usage: Schema.optional(Schema.JsonObject),
    }),
  ),
}).check(boundedChatJson)

const storedChatPart = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct({ version: Schema.Literal(1), ...fields }), [
    Schema.JsonObject,
  ])

export const ChatMessagePartPayloadSchema = Schema.Union([
  storedChatPart({
    type: Schema.Literals(["text", "thinking", "reasoning"]),
    content: Schema.String,
  }),
  storedChatPart({
    type: Schema.Literal("tool-call"),
    name: Schema.String,
    arguments: Schema.String,
    toolCallId: Schema.String,
  }),
  storedChatPart({
    type: Schema.Literal("tool-result"),
    outcome: Schema.Literals(["succeeded", "failed", "skipped", "unknown"]),
    output: Schema.Json,
  }),
  storedChatPart({
    type: Schema.Literals(["image", "audio", "video", "document"]),
    source: Schema.JsonObject,
  }),
  storedChatPart({
    type: Schema.Literal("structured-output"),
    status: Schema.Literals(["streaming", "complete", "error"]),
    raw: Schema.String,
  }),
  storedChatPart({ type: Schema.Literal("ui-resource"), resource: Schema.JsonObject }),
  storedChatPart({ type: Schema.Literal("subagent"), subagent: Schema.JsonObject }),
]).check(
  boundedChatJson,
  Schema.makeFilter(
    (part) =>
      part.id === undefined && part.targets === undefined && part.executionLocation === undefined,
  ),
)
