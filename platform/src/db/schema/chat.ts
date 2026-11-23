import { sql } from "drizzle-orm"
import { Schema } from "effect"
import {
  check,
  index,
  integer,
  pgEnum,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type ForeignKeyBuilder,
} from "drizzle-orm/pg-core"

import { ApiUuidSchema, UuidV7Schema } from "@/lib/schemas.ts"
import { defineTable, primaryKey } from "@/lib/persistence.server"
import {
  deferrableForeignKey,
  jsonb,
  lockVersion,
  timestamps,
  uuidV7,
  text,
} from "../lib/columns.ts"
import { fileObject } from "./files.ts"
import type { OrganizationId, TenantId, TenantUserId } from "@/db/schema/organizations"
import { agent, tenantForeignKey, tenantUserForeignKey } from "./organizations.ts"

function chatThreadForeignKey(
  table: Record<"organizationId" | "tenantId" | "threadId", AnyPgColumn>,
) {
  return deferrableForeignKey({
    columns: [table.organizationId, table.tenantId, table.threadId],
    foreignColumns: [chatThread.organizationId, chatThread.tenantId, chatThread.id],
  }).onDelete("cascade")
}

function chatMessageForeignKey(
  table: Record<"organizationId" | "tenantId" | "threadId", AnyPgColumn>,
  messageId: AnyPgColumn,
  options: {
    name?: string
    deferrable?: "immediate" | "deferred"
  } = {},
): ForeignKeyBuilder {
  return deferrableForeignKey({
    ...options,
    columns: [table.organizationId, table.tenantId, table.threadId, messageId],
    foreignColumns: [
      chatMessage.organizationId,
      chatMessage.tenantId,
      chatMessage.threadId,
      chatMessage.id,
    ],
  })
}

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
      initiatorTenantUserId: Schema.optional(UuidV7Schema),
      clientId: Schema.optional(ApiUuidSchema),
      clientMessageId: Schema.optional(ApiUuidSchema),
      providerId: Schema.optional(Schema.String),
      providerType: Schema.optional(Schema.String),
      protocol: Schema.optional(Schema.String),
      modelId: Schema.optional(Schema.String),
      contextKey: Schema.optional(Schema.String),
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
export const chatThread = defineTable(
  "chat_thread",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7(),
    // Selected Organization-owned agent, bound at creation rather than following default-agent changes.
    // Agent deletion clears only this reference. Null preserves readable history but prevents new generation.
    agentId: uuidV7({ generated: false }),
    // Empty uses the client's generic label. Renaming updates activity ordering.
    title: text().default("").notNull(),
    // Last node on the default history path. Follow parentMessageId from this node to reconstruct the transcript.
    // Null means no messages. Appends advance it atomically, and completing an older draft must not move it backward.
    currentLeafMessageId: uuidV7({ generated: false }),
    lockVersion: lockVersion(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    index("chat_thread_activity_idx").on(
      table.organizationId,
      table.tenantId,
      table.updatedAt,
      table.id,
    ),
    tenantForeignKey(table).onDelete("cascade"),
    // Migration SQL limits SET NULL to agent_id, preserving organization_id.
    // https://www.postgresql.org/docs/18/sql-createtable.html
    deferrableForeignKey({
      name: "chat_thread_agent_fk",
      columns: [table.organizationId, table.agentId],
      foreignColumns: [agent.organizationId, agent.id],
    }).onDelete("set null"),
    // Defer this circular reference until commit.
    // https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-FK
    chatMessageForeignKey({ ...table, threadId: table.id }, table.currentLeafMessageId, {
      name: "chat_thread_current_leaf_fk",
      deferrable: "deferred",
    }),
  ],
)

/**
 * One TenantUser's access grant across all their clients. Viewers read, members also send, and managers manage the thread.
 * Creation grants manager access to the requester. Revoking membership preserves historical message authorship.
 */
export const chatParticipant = defineTable(
  "chat_participant",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7(),
    threadId: uuidV7({ generated: false }).notNull(),
    // Internal TenantUser receiving access, not an Organization dashboard user or a browser client identifier.
    // All of this user's authenticated clients share the grant. Deleting the TenantUser cascades the grant.
    tenantUserId: uuidV7({ generated: false }).$type<TenantUserId>().notNull(),
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
    chatThreadForeignKey(table),
    tenantUserForeignKey(table).onDelete("cascade"),
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
export const chatMessage = defineTable(
  "chat_message",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7(),
    threadId: uuidV7({ generated: false }).notNull(),
    // Preceding transcript node, immutable after insertion. Null identifies a root.
    parentMessageId: uuidV7({ generated: false }),
    // Initiating user input for assistant/tool messages, null on user inputs. This differs from the preceding transcript node.
    // Concurrent participant appends can interleave activity from several turns on the same parent-linked path.
    turnMessageId: uuidV7({ generated: false }),
    // Human author or browser-result submitter. Membership removal does not erase authorship.
    // The migration defers this reference until commit so whole-Tenant deletion can cascade before authorship is checked.
    authorTenantUserId: uuidV7({ generated: false }).$type<TenantUserId>(),
    // Transcript kind, independent of participant permissions and tool execution location.
    role: chatMessageRoleEnum().notNull(),
    // Only assistant output can be draft or interrupted. Complete decisions can still await results.
    state: chatMessageStateEnum().notNull(),
    // Versioned, validated provenance, provider continuation, and input tool declarations. The current invocation ID fences producer writes.
    // Credentials are excluded. Visible content belongs in message parts, and provider context is derived separately.
    metadata: jsonb({ schema: ChatMessageMetadataSchema }).notNull(),
    // Lifecycle on the initiating user message. Its accepted content remains complete throughout execution.
    turnState: chatMessageTurnStateEnum(),
    ...timestamps(),
  },
  (table) => [
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
    index("chat_message_user_usage_idx")
      .on(
        table.organizationId,
        table.tenantId,
        sql`(${table.metadata}->'provenance'->>'initiatorTenantUserId')`,
        table.createdAt,
      )
      .where(sql`${table.role} = 'assistant'`),
    chatThreadForeignKey(table),
    chatMessageForeignKey(table, table.parentMessageId, { name: "chat_message_parent_fk" }),
    chatMessageForeignKey(table, table.turnMessageId, { name: "chat_message_turn_fk" }),
    tenantUserForeignKey(
      { ...table, tenantUserId: table.authorTenantUserId },
      { name: "chat_message_author_user_fk", deferrable: "deferred" },
    ),
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
export const chatMessagePart = defineTable(
  "chat_message_part",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7(),
    threadId: uuidV7({ generated: false }).notNull(),
    messageId: uuidV7({ generated: false }).notNull(),
    // Explicit zero-based order within a message. The scoped message/position unique index rejects ambiguous ordering.
    // Assigned without a default. Draft positions can shift when final reasoning arrives, while part IDs stay stable.
    position: integer().notNull(),
    // Versioned content for text, reasoning, attachments, widgets, tool decisions, or accepted tool results.
    // Original uploads and tool declarations remain here. This table is not limited to tool-related content.
    payload: jsonb({ schema: ChatMessagePartPayloadSchema }).notNull(),
    // Where this tool decision should execute. Specific responders are recorded in chat_tool_response.
    executionLocation: chatMessagePartExecutionLocationEnum(),
    ...timestamps(),
  },
  (table) => [
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
    chatMessageForeignKey(table, table.messageId).onDelete("cascade"),
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
export const chatToolResponse = defineTable(
  "chat_tool_response",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    id: uuidV7(),
    threadId: uuidV7({ generated: false }).notNull(),
    // Committed tool-decision part requesting this response, distinct from the provider's tool-call ID.
    // One decision can have several response rows, including different browser clients belonging to the same user.
    toolPartId: uuidV7({ generated: false }).notNull(),
    // Intended human responder. Null for server API and sandbox executions.
    // The migration defers this reference until commit so Tenant deletion removes response slots before checking recipients.
    tenantUserId: uuidV7({ generated: false }).$type<TenantUserId>(),
    // Intended browser instance. This is a routing identity, never an authorization credential.
    clientId: uuid(),
    // Accepted immutable tool-result message or explicit closure. Outcome and output live in that message's result part.
    // Cascading result deletion keeps whole-thread removal independent of the order of message and part cascades.
    resultMessageId: uuidV7({ generated: false }),
    ...timestamps(),
  },
  (table) => [
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
    chatMessageForeignKey(table, table.resultMessageId, {
      name: "chat_tool_response_result_fk",
    }).onDelete("cascade"),
    tenantUserForeignKey(table, { deferrable: "deferred" }),
  ],
)

// Uploads belong to their uploader until sending attaches them to a message.
export const chatFile = defineTable(
  "chat_file",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    id: uuidV7(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    uploaderTenantUserId: uuidV7({ generated: false }).$type<TenantUserId>().notNull(),
    fileObjectId: uuidV7({ generated: false }).notNull(),
    threadId: uuidV7({ generated: false }),
    messageId: uuidV7({ generated: false }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    index().on(table.organizationId, table.tenantId, table.fileObjectId),
    index().on(table.organizationId, table.tenantId, table.threadId),
    tenantUserForeignKey({ ...table, tenantUserId: table.uploaderTenantUserId }).onDelete(
      "cascade",
    ),
    chatMessageForeignKey(table, table.messageId).onDelete("cascade"),
    deferrableForeignKey({
      columns: [table.organizationId, table.fileObjectId],
      foreignColumns: [fileObject.organizationId, fileObject.id],
    }).onDelete("cascade"),
  ],
)

const ChatCompactionPayloadSchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literals(["portable", "native"]),
  messages: Schema.Array(Schema.JsonObject),
})

export const chatCompaction = defineTable(
  "chat_compaction",
  {
    organizationId: uuidV7({ generated: false }).$type<OrganizationId>().notNull(),
    id: uuidV7(),
    tenantId: uuidV7({ generated: false }).$type<TenantId>().notNull(),
    threadId: uuidV7({ generated: false }).notNull(),
    coveredThroughMessageId: uuidV7({ generated: false }).notNull(),
    compatibilityKey: text().notNull(),
    payload: jsonb({ schema: ChatCompactionPayloadSchema }).notNull(),
    usage: jsonb({ schema: Schema.JsonObject }).notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.tenantId, table.id] }),
    uniqueIndex("chat_compaction_anchor_uidx").on(
      table.organizationId,
      table.tenantId,
      table.threadId,
      table.coveredThroughMessageId,
      table.compatibilityKey,
      sql`(${table.payload}->>'kind')`,
    ),
    chatThreadForeignKey(table),
    chatMessageForeignKey(table, table.coveredThroughMessageId).onDelete("cascade"),
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
