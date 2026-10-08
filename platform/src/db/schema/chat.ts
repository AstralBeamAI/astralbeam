import { sql } from "drizzle-orm"
import { Schema } from "effect"
import {
  check,
  index,
  integer,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  uniqueIndex,
  uuid,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core"

import { ApiUuidSchema } from "../../lib/tenants/schemas.ts"
import {
  deferrableForeignKey,
  schemaJsonb,
  lockVersion,
  timestamps,
  uuidV7,
} from "../lib/columns.ts"
import { agent, tenant, tenantUser } from "./organizations.ts"

const boundedChatJson = Schema.makeFilter(
  (value: unknown) => JSON.stringify(value).length <= 32 * 1024 * 1024,
)

const ChatMessageMetadataSchema = Schema.Struct({
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

const ChatMessagePartPayloadSchema = Schema.Union([
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
]).check(boundedChatJson)

const chatParticipantRoleEnum = pgEnum("chat_participant_role", ["viewer", "member", "manager"])
const chatMessageRoleEnum = pgEnum("chat_message_role", ["user", "assistant", "tool"])
const chatMessageStateEnum = pgEnum("chat_message_state", ["draft", "complete", "interrupted"])

/**
 * Shared Tenant conversation with a selected agent and default history leaf, authorized through participant grants.
 * Parent links allow future branches. Independent turns can execute concurrently, and updatedAt orders thread activity.
 */
export const chatThread = snakeCase.table(
  "chat_thread",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    // Selected Organization-owned agent, bound at creation rather than following default-agent changes.
    // Agent deletion clears only this reference. Null preserves readable history but prevents new generation.
    agentId: uuid(),
    // Empty uses the client's generic label. Renaming updates activity ordering.
    title: text().default("").notNull(),
    // Last node on the default history path. Follow parentMessageId from this node to reconstruct the transcript.
    // Null means no messages. Appends advance it atomically, and completing an older draft must not move it backward.
    currentLeafMessageId: uuid(),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    index("chat_thread_activity_idx").on(
      table.organizationId,
      table.tenantId,
      table.updatedAt,
      table.id,
    ),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId],
      foreignColumns: [tenant.organizationId, tenant.id],
    }).onDelete("cascade"),
    // Migration SQL limits SET NULL to agent_id, preserving organization_id.
    // https://www.postgresql.org/docs/18/sql-createtable.html
    deferrableForeignKey({
      name: "chat_thread_agent_fk",
      columns: [table.organizationId, table.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("set null"),
    // Defer this circular reference until commit.
    // https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK
    deferrableForeignKey({
      name: "chat_thread_current_leaf_fk",
      deferrable: "deferred",
      columns: [table.organizationId, table.tenantId, table.id, table.currentLeafMessageId],
      foreignColumns: [
        chatMessage.organizationId,
        chatMessage.tenantId,
        chatMessage.threadId,
        chatMessage.id,
      ],
    }),
  ],
)

/**
 * One TenantUser's access grant across all their clients. Viewers read, members also send, and managers manage the thread.
 * Creation grants manager access to the requester. Revoking membership preserves historical message authorship.
 */
export const chatParticipant = snakeCase.table(
  "chat_participant",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    threadId: uuid().notNull(),
    // Internal TenantUser receiving access, not an Organization dashboard user or a browser client identifier.
    // All of this user's authenticated clients share the grant. Deleting the TenantUser cascades the grant.
    tenantUserId: uuid().notNull(),
    // viewer reads history, member also sends and resolves permitted interactions, manager also manages the conversation.
    // Managers can rename, delete, and change participants. The creator starts as a manager, without permanent ownership.
    role: chatParticipantRoleEnum().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    uniqueIndex("chat_participant_user_uidx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.tenantUserId,
    ),
    index("chat_participant_access_idx").on(
      table.organizationId,
      table.tenantId,
      table.tenantUserId,
      table.threadId,
    ),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.threadId],
      foreignColumns: [chatThread.organizationId, chatThread.tenantId, chatThread.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }).onDelete("cascade"),
  ],
)

const chatMessageTurnStateEnum = pgEnum("chat_message_turn_state", [
  "running",
  "waiting",
  "completed",
  "interrupted",
])
const chatMessagePartExecutionLocationEnum = pgEnum("chat_message_part_execution_location", [
  "server_api",
  "sandbox",
  "browser",
  "provider",
])

/**
 * Transcript node with ordered content parts. Parent links define history, while turn links identify the initiating input.
 * The input holds turn state and metadata invocation identity. Interruption preserves accepted input and saved results.
 */
export const chatMessage = snakeCase.table(
  "chat_message",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    threadId: uuid().notNull(),
    // Preceding transcript node, immutable after insertion. Null identifies a root.
    parentMessageId: uuid(),
    // Initiating user input for assistant/tool messages, null on user inputs. This differs from the preceding transcript node.
    // Concurrent participant appends can interleave activity from several turns on the same parent-linked path.
    turnMessageId: uuid(),
    // Human author or browser-result submitter. Membership removal does not erase authorship.
    // The migration defers this reference until commit so whole-Tenant deletion can cascade before authorship is checked.
    authorTenantUserId: uuid(),
    // Transcript kind, independent of participant permissions and tool execution location.
    role: chatMessageRoleEnum().notNull(),
    // Only assistant output can be draft or interrupted. Complete decisions can still await results.
    state: chatMessageStateEnum().notNull(),
    // Versioned, validated provenance, provider continuation, and input tool declarations. The current invocation ID fences producer writes.
    // Credentials are excluded. Visible content belongs in message parts, and provider context is derived separately.
    metadata: schemaJsonb(ChatMessageMetadataSchema).notNull(),
    // Lifecycle on the initiating user message. Its accepted content remains complete throughout execution.
    turnState: chatMessageTurnStateEnum(),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [table.organizationId, table.tenantId, table.threadId, table.id],
    }),
    uniqueIndex("chat_message_turn_draft_uidx")
      .on(table.organizationId, table.tenantId, table.threadId, table.turnMessageId)
      .where(sql`${table.state} = 'draft'`),
    index("chat_message_parent_idx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.parentMessageId,
    ),
    index("chat_message_turn_idx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.turnMessageId,
    ),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.threadId],
      foreignColumns: [chatThread.organizationId, chatThread.tenantId, chatThread.id],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "chat_message_parent_fk",
      columns: [table.organizationId, table.tenantId, table.threadId, table.parentMessageId],
      foreignColumns: [table.organizationId, table.tenantId, table.threadId, table.id],
    }),
    deferrableForeignKey({
      name: "chat_message_turn_fk",
      columns: [table.organizationId, table.tenantId, table.threadId, table.turnMessageId],
      foreignColumns: [table.organizationId, table.tenantId, table.threadId, table.id],
    }),
    deferrableForeignKey({
      name: "chat_message_author_user_fk",
      deferrable: "deferred",
      columns: [table.organizationId, table.tenantId, table.authorTenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }),
    check(
      "chat_message_role_check",
      sql`(
    (${table.role} = 'user' and ${table.state} = 'complete' and ${table.authorTenantUserId} is not null and ${table.turnMessageId} is null and ${table.turnState} is not null)
    or (${table.role} in ('assistant', 'tool') and ${table.turnMessageId} is not null and ${table.turnState} is null)
  ) and (${table.role} = 'assistant' or ${table.state} = 'complete') and (${table.role} <> 'assistant' or ${table.authorTenantUserId} is null)`,
    ),
    check(
      "chat_message_ancestry_check",
      sql`${table.parentMessageId} is distinct from ${table.id} and ${table.turnMessageId} is distinct from ${table.id}`,
    ),
  ],
)

/**
 * Ordered message content: text, reasoning, attachments, widgets, tool decisions, or results, restored without reexecution.
 * Tool decisions retain their declaration and location. Their stable part IDs anchor one or more expected responses.
 */
export const chatMessagePart = snakeCase.table(
  "chat_message_part",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    threadId: uuid().notNull(),
    messageId: uuid().notNull(),
    // Explicit zero-based order within a message. The scoped message/position unique index rejects ambiguous ordering.
    // Assigned without a default. Draft positions can shift when final reasoning arrives, while part IDs stay stable.
    position: integer().notNull(),
    // Versioned content for text, reasoning, attachments, widgets, tool decisions, or accepted tool results.
    // Original uploads and tool declarations remain here. This table is not limited to tool-related content.
    payload: schemaJsonb(ChatMessagePartPayloadSchema).notNull(),
    // Where this tool decision should execute. Specific responders are recorded in chat_tool_response.
    executionLocation: chatMessagePartExecutionLocationEnum(),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [table.organizationId, table.tenantId, table.threadId, table.id],
    }),
    uniqueIndex("chat_message_part_position_uidx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.messageId,
      table.position,
    ),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.threadId, table.messageId],
      foreignColumns: [
        chatMessage.organizationId,
        chatMessage.tenantId,
        chatMessage.threadId,
        chatMessage.id,
      ],
    }).onDelete("cascade"),
    check("chat_message_part_position_check", sql`${table.position} >= 0`),
    check(
      "chat_message_part_location_check",
      sql`(${table.payload}->>'type' = 'tool-call') = (${table.executionLocation} is not null)`,
    ),
  ],
)

/**
 * One expected response to a committed tool decision, created before execution or delivery, optionally targeting a user/client.
 * Several slots support multiple responders. A null result means outstanding, not failed. Accepted results are immutable.
 */
export const chatToolResponse = snakeCase.table(
  "chat_tool_response",
  {
    organizationId: uuid().notNull(),
    tenantId: uuid().notNull(),
    id: uuidV7(),
    threadId: uuid().notNull(),
    // Committed tool-decision part requesting this response, distinct from the provider's tool-call ID.
    // One decision can have several response rows, including different browser clients belonging to the same user.
    toolPartId: uuid().notNull(),
    // Intended human responder. Null for server API and sandbox executions.
    // The migration defers this reference until commit so Tenant deletion removes response slots before checking recipients.
    tenantUserId: uuid(),
    // Intended browser instance. This is a routing identity, never an authorization credential.
    clientId: uuid(),
    // Accepted immutable tool-result message or explicit closure. Outcome and output live in that message's result part.
    // Cascading result deletion keeps whole-thread removal independent of the order of message and part cascades.
    resultMessageId: uuid(),
    ...timestamps(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    index("chat_tool_response_part_idx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.toolPartId,
    ),
    uniqueIndex("chat_tool_response_result_uidx")
      .on(table.organizationId, table.tenantId, table.threadId, table.resultMessageId)
      .where(sql`${table.resultMessageId} is not null`),
    deferrableForeignKey({
      columns: [table.organizationId, table.tenantId, table.threadId, table.toolPartId],
      foreignColumns: [
        chatMessagePart.organizationId,
        chatMessagePart.tenantId,
        chatMessagePart.threadId,
        chatMessagePart.id,
      ],
    }).onDelete("cascade"),
    deferrableForeignKey({
      name: "chat_tool_response_result_fk",
      columns: [table.organizationId, table.tenantId, table.threadId, table.resultMessageId],
      foreignColumns: [
        chatMessage.organizationId,
        chatMessage.tenantId,
        chatMessage.threadId,
        chatMessage.id,
      ],
    }).onDelete("cascade"),
    deferrableForeignKey({
      deferrable: "deferred",
      columns: [table.organizationId, table.tenantId, table.tenantUserId],
      foreignColumns: [tenantUser.organizationId, tenantUser.tenantId, tenantUser.id],
    }),
  ],
)

/** @knipignore Drizzle Kit discovers these enums through schema.ts. */
export {
  chatParticipantRoleEnum,
  chatMessageRoleEnum,
  chatMessageStateEnum,
  chatMessageTurnStateEnum,
  chatMessagePartExecutionLocationEnum,
}
