import { isDeepStrictEqual } from "node:util"
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  isNotNull,
  isNull,
  inArray,
  lt,
  like,
  or,
  sql,
} from "drizzle-orm"
import { Array as EffectArray, Context, Effect, Layer, Schema } from "effect"

import { Database, type EffectDatabase } from "@/db/database.server"
import { cacheEntry } from "@/db/schema/cache.server"
import {
  databasePage,
  type DatabasePage,
  type DatabasePageOptions,
} from "@/db/lib/pagination.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import {
  deleteWithOptimisticLock,
  updateWithOptimisticLock,
} from "@/db/lib/optimistic-locking.server"
import {
  chatThread,
  chatMessage,
  chatMessagePart,
  chatToolResponse,
  chatParticipant,
} from "@/db/schema/chat.server"
import {
  tenant,
  tenantUser,
  agent,
  organizationConfiguration,
} from "@/db/schema/organizations.server"
import type { ChatPrincipal } from "../types"
import { base64ByteLength } from "../attachments/attachments.server"
import { CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "../attachments/constants.server"
import { parseAgentId } from "@/lib/agents/schemas"
import { tenantUserEmail } from "@/lib/tenants/schemas"
import type { TenantScope } from "@/lib/tenants/tenants.server"
import { tenantSearchPattern } from "@/lib/tenants/tenants.server"
import {
  ChatThreadConflict,
  ChatThreadForbidden,
  ChatThreadInvalid,
  ChatThreadNotFound,
  ChatIdentityNotSynchronized,
  type ChatThreadError,
} from "./errors.ts"
import {
  ChatMessagePayloadSchema,
  ChatToolDecisionSchema,
  type ChatThreadScope,
  type ChatMessagePayload,
  type ChatParticipantRole,
  type ChatToolResolution,
  type ChatWriterClaim,
} from "./schemas.ts"

type ChatReadScope = Pick<ChatThreadScope, "organizationId" | "tenantId">
export interface DirectoryThreadInput {
  readonly scope: TenantScope
  readonly tenantId: string
  readonly id: string
}
export type DirectoryThreadRecord = typeof chatThread.$inferSelect & {
  tenantName: string | null
  tenantExternalId: string
}
type StoredMessageRecord = typeof chatMessage.$inferSelect
export type MessageRecord = StoredMessageRecord & {
  payload: ChatMessagePayload
  sourceAssistantMessageId: string | null
  sourceToolPartId: string | null
  responseTargetId: string | null
}
export type ParticipantRecord = typeof chatParticipant.$inferSelect & {
  name: string | null
  externalId: string
  email: string | null
}
export type ThreadRecord = typeof chatThread.$inferSelect & {
  role: ChatParticipantRole
  writerActive: boolean
}
export interface ThreadInput {
  readonly scope: ChatThreadScope
  readonly id: string
}
export interface ChatAdmission {
  readonly thread: ThreadRecord
  readonly inputMessage: MessageRecord
  readonly assistantMessage: MessageRecord | null
  readonly claim: ChatWriterClaim | null
}
export interface AdmitInput extends ThreadInput {
  readonly payload: ChatMessagePayload
}
export interface ResolveToolsInput extends ThreadInput {
  readonly results: readonly ChatToolResolution[]
  readonly clientId: string
}

type Executor = Pick<EffectDatabase, "select" | "insert" | "update" | "delete" | "execute">
const threadExecutionActive = sql<boolean>`exists (
  select 1 from chat_message execution
  where execution.organization_id = ${chatThread.organizationId}
    and execution.tenant_id = ${chatThread.tenantId}
    and execution.thread_id = ${chatThread.id}
    and execution.turn_state = 'running'
)`.mapWith(Boolean)
const scopeWhere = (scope: ChatReadScope, id: string) =>
  and(
    eq(chatThread.organizationId, scope.organizationId),
    eq(chatThread.tenantId, scope.tenantId),
    eq(chatThread.id, id),
  )!
const messageWhere = (scope: ChatReadScope, id: string) =>
  and(
    eq(chatMessage.organizationId, scope.organizationId),
    eq(chatMessage.tenantId, scope.tenantId),
    eq(chatMessage.threadId, id),
  )
const participantWhere = (scope: ChatThreadScope, id: string) =>
  and(
    eq(chatParticipant.organizationId, scope.organizationId),
    eq(chatParticipant.tenantId, scope.tenantId),
    eq(chatParticipant.threadId, id),
  )
const rowScope = (scope: ChatThreadScope) => ({
  organizationId: scope.organizationId,
  tenantId: scope.tenantId,
})
const decodePayload = Schema.decodeUnknownEffect(ChatMessagePayloadSchema)

const validateCompletePayload = Effect.fnUntraced(function* (payload: ChatMessagePayload) {
  for (const part of payload.parts) {
    if (part.type === "tool-call")
      yield* Schema.decodeUnknownEffect(ChatToolDecisionSchema)(part).pipe(Effect.orDie)
  }
})

const chatPartWhere = (scope: ChatReadScope, id: string) =>
  and(
    eq(chatMessagePart.organizationId, scope.organizationId),
    eq(chatMessagePart.tenantId, scope.tenantId),
    eq(chatMessagePart.threadId, id),
  )
const chatResponseWhere = (scope: ChatReadScope, id: string) =>
  and(
    eq(chatToolResponse.organizationId, scope.organizationId),
    eq(chatToolResponse.tenantId, scope.tenantId),
    eq(chatToolResponse.threadId, id),
  )

function chatMetadata(payload: ChatMessagePayload): typeof chatMessage.$inferInsert.metadata {
  const { parts: _parts, turnId: _turn, ...metadata } = payload
  return metadata
}

const readChatMessages = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatReadScope,
  id: string,
  rows: StoredMessageRecord[],
  partIds?: readonly string[],
) {
  if (rows.length === 0) return []
  const messageIds = rows.map((row) => row.id)
  const parts = yield* db
    .select()
    .from(chatMessagePart)
    .where(
      and(
        chatPartWhere(scope, id),
        partIds ? inArray(chatMessagePart.id, partIds) : undefined,
        inArray(chatMessagePart.messageId, messageIds),
      ),
    )
    .orderBy(asc(chatMessagePart.position))
  const responses = yield* db
    .select({ response: chatToolResponse, messageId: chatMessagePart.messageId })
    .from(chatToolResponse)
    .innerJoin(
      chatMessagePart,
      and(
        eq(chatMessagePart.organizationId, chatToolResponse.organizationId),
        eq(chatMessagePart.tenantId, chatToolResponse.tenantId),
        eq(chatMessagePart.threadId, chatToolResponse.threadId),
        eq(chatMessagePart.id, chatToolResponse.toolPartId),
      ),
    )
    .where(
      and(
        chatResponseWhere(scope, id),
        or(
          inArray(chatMessagePart.messageId, messageIds),
          inArray(chatToolResponse.resultMessageId, messageIds),
        ),
      ),
    )
    .orderBy(asc(chatToolResponse.id))
  const partsByMessage = EffectArray.groupBy(parts, (part) => part.messageId)
  const responsesByPart = EffectArray.groupBy(responses, ({ response }) => response.toolPartId)
  const sources = new Map(responses.map((source) => [source.response.resultMessageId, source]))
  return rows.map((row): MessageRecord => {
    const source = sources.get(row.id)
    const content = (partsByMessage[row.id] ?? []).map((part) => {
      const { version: _version, ...payload } = part.payload
      return {
        ...payload,
        id: part.id,
        ...(part.executionLocation
          ? {
              executionLocation: part.executionLocation,
              targets: (responsesByPart[part.id] ?? []).map(({ response }) => ({
                id: response.id,
                ...(response.tenantUserId ? { tenantUserId: response.tenantUserId } : {}),
                ...(response.clientId ? { clientId: response.clientId } : {}),
              })),
            }
          : {}),
      }
    })
    return {
      ...row,
      payload: Schema.decodeUnknownSync(ChatMessagePayloadSchema)({
        ...row.metadata,
        parts: content,
        ...(row.turnMessageId ? { turnId: row.turnMessageId } : {}),
      }),
      sourceAssistantMessageId: source?.messageId ?? null,
      sourceToolPartId: source?.response.toolPartId ?? null,
      responseTargetId: source?.response.id ?? null,
    }
  })
})

const insertChatContent = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatThreadScope,
  threadId: string,
  messageId: string,
  payload: ChatMessagePayload,
) {
  if (payload.parts.length)
    yield* db.insert(chatMessagePart).values(
      payload.parts.map((part, position) => {
        const { id: _id, ...content } = part
        return {
          ...rowScope(scope),
          threadId,
          messageId,
          position,
          payload: { ...content, version: 1 } as typeof chatMessagePart.$inferInsert.payload,
        }
      }),
    )
})

const saveChatParts = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatThreadScope,
  threadId: string,
  messageId: string,
  payload: ChatMessagePayload,
) {
  const previous = yield* db
    .select()
    .from(chatMessagePart)
    .where(and(chatPartWhere(scope, threadId), eq(chatMessagePart.messageId, messageId)))
    .orderBy(asc(chatMessagePart.position))
  if (previous.some((part) => payload.parts[part.position]?.id !== part.id)) {
    const ids = new Set(payload.parts.map((part) => part.id))
    if (previous.some((part) => !ids.has(part.id))) return yield* new ChatThreadConflict()
    // Final provider output can prepend reasoning omitted by streaming snapshots.
    // Move draft positions out of the final range before updating the unique positions.
    yield* db
      .update(chatMessagePart)
      .set({ position: sql`${chatMessagePart.position} + ${payload.parts.length}` })
      .where(and(chatPartWhere(scope, threadId), eq(chatMessagePart.messageId, messageId)))
  }
  for (const [position, part] of payload.parts.entries()) {
    const { id, executionLocation, targets: _targets, ...content } = part
    if (typeof id !== "string") return yield* new ChatThreadInvalid()
    const location =
      part.type === "tool-call"
        ? Schema.decodeUnknownSync(Schema.Literals(["server_api", "sandbox", "browser"]))(
            executionLocation,
          )
        : null
    const values = {
      ...rowScope(scope),
      id,
      threadId,
      messageId,
      position,
      payload: { ...content, version: 1 } as typeof chatMessagePart.$inferInsert.payload,
      executionLocation: location,
    }
    const written = yield* db
      .insert(chatMessagePart)
      .values(values)
      .onConflictDoUpdate({
        target: [
          chatMessagePart.organizationId,
          chatMessagePart.tenantId,
          chatMessagePart.threadId,
          chatMessagePart.id,
        ],
        set: { payload: values.payload, executionLocation: location, position },
        setWhere: eq(chatMessagePart.messageId, messageId),
      })
      .returning({ id: chatMessagePart.id })
    if (!written.length) return yield* new ChatThreadConflict()
    if (part.type !== "tool-call") continue
    for (const target of toolTargets(part)) {
      const targetId = Schema.decodeUnknownSync(Schema.String.check(Schema.isUUID()))(target.id)
      const recipient = typeof target.tenantUserId === "string" ? target.tenantUserId : null
      const clientId = typeof target.clientId === "string" ? target.clientId : null
      if (location === "browser") {
        if (!recipient || !clientId) return yield* new ChatThreadInvalid()
        const [participant] = yield* db
          .select({ id: chatParticipant.id })
          .from(chatParticipant)
          .where(
            and(
              participantWhere(scope, threadId),
              eq(chatParticipant.tenantUserId, recipient),
              sql`${chatParticipant.role} <> 'viewer'`,
            ),
          )
        if (!participant) return yield* new ChatThreadForbidden()
      } else if (recipient || clientId) return yield* new ChatThreadInvalid()
      const [existing] = yield* db
        .select()
        .from(chatToolResponse)
        .where(and(chatResponseWhere(scope, threadId), eq(chatToolResponse.id, targetId)))
      if (existing) {
        if (
          existing.toolPartId !== id ||
          existing.tenantUserId !== recipient ||
          existing.clientId !== clientId
        )
          return yield* new ChatThreadConflict()
      } else
        yield* db.insert(chatToolResponse).values({
          ...rowScope(scope),
          threadId,
          toolPartId: id,
          id: targetId,
          tenantUserId: recipient,
          clientId,
        })
    }
  }
})

const readThread = Effect.fnUntraced(function* (db: Executor, input: ThreadInput, lock = false) {
  if (lock)
    yield* db
      .select({ id: chatThread.id })
      .from(chatThread)
      .where(scopeWhere(input.scope, input.id))
      .for("update")
  const [row] = yield* db
    .select({
      ...getTableColumns(chatThread),
      role: chatParticipant.role,
      writerActive: threadExecutionActive,
    })
    .from(chatThread)
    .innerJoin(
      chatParticipant,
      and(
        eq(chatParticipant.organizationId, chatThread.organizationId),
        eq(chatParticipant.tenantId, chatThread.tenantId),
        eq(chatParticipant.threadId, chatThread.id),
        eq(chatParticipant.tenantUserId, input.scope.tenantUserId),
      ),
    )
    .where(scopeWhere(input.scope, input.id))
    .limit(1)
  if (!row) return yield* new ChatThreadNotFound()
  return row
})

function requireRole(row: ThreadRecord, manager = false) {
  return row.role === "viewer" || (manager && row.role !== "manager")
    ? Effect.fail(new ChatThreadForbidden())
    : Effect.void
}

const readMessage = Effect.fnUntraced(function* (
  db: Executor,
  input: { scope: ChatReadScope; id: string },
  messageId: string,
) {
  const [row] = yield* db
    .select()
    .from(chatMessage)
    .where(and(messageWhere(input.scope, input.id), eq(chatMessage.id, messageId)))
    .limit(1)
  if (!row) return yield* new ChatThreadNotFound()
  return (yield* readChatMessages(db, input.scope, input.id, [row]))[0]!
})

const historyIds = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatReadScope,
  id: string,
  leaf: string | null,
  turnId?: string,
) {
  return yield* db.execute<{ id: string }>(
    sql`with recursive history as (
    select id, parent_message_id, role, turn_message_id, 1 as depth from chat_message
    where organization_id = ${scope.organizationId} and tenant_id = ${scope.tenantId}
      and thread_id = ${id} and id = ${leaf}
    union all
    select parent.id, parent.parent_message_id, parent.role, parent.turn_message_id, history.depth + 1
    from chat_message parent join history on parent.id = history.parent_message_id
    where parent.organization_id = ${scope.organizationId} and parent.tenant_id = ${scope.tenantId}
      and parent.thread_id = ${id}
  ) select id from history ${turnId === undefined ? sql`order by depth desc` : sql`where role = 'assistant' and turn_message_id = ${turnId} order by depth limit 1`}`,
    "objects",
  )
})

const checkClaim = Effect.fnUntraced(function* (db: Executor, claim: ChatWriterClaim) {
  const row = yield* readThread(db, { scope: claim.scope, id: claim.threadId }, true)
  yield* requireRole(row)
  const [turn] = yield* db
    .select()
    .from(chatMessage)
    .where(
      and(
        messageWhere(claim.scope, claim.threadId),
        eq(chatMessage.id, claim.inputMessageId),
        sql`${chatMessage.metadata}->>'invocationId' = ${claim.invocationId}`,
        eq(chatMessage.turnState, "running"),
      ),
    )
    .for("update")
  if (!turn) return yield* new ChatThreadConflict()
  const message = yield* readMessage(
    db,
    { scope: claim.scope, id: claim.threadId },
    claim.assistantMessageId,
  )
  if (
    message.turnMessageId !== turn.id ||
    message.role !== "assistant" ||
    message.state === "interrupted" ||
    message.metadata.invocationId !== claim.invocationId ||
    message.metadata.provenance?.initiatorTenantUserId !== claim.scope.tenantUserId
  )
    return yield* new ChatThreadConflict()
  if (message.state === "complete") {
    // A completed phase cannot finalize or interrupt a later phase of the same invocation.
    const [latest] = yield* historyIds(
      db,
      claim.scope,
      claim.threadId,
      row.currentLeafMessageId,
      turn.id,
    )
    if (latest?.id !== message.id) return yield* new ChatThreadConflict()
  }
  return { thread: row, message }
})

const persistChatOutput = Effect.fnUntraced(function* (
  db: Executor,
  claim: ChatWriterClaim,
  message: MessageRecord,
  content: ChatMessagePayload,
  state: "draft" | "complete",
) {
  const payload = yield* decodePayload(content).pipe(Effect.orDie)
  if (state === "complete") yield* validateCompletePayload(payload)
  const updated = yield* db
    .update(chatMessage)
    .set({
      metadata: chatMetadata(executionPayload(payload, claim, message.payload)),
      state,
    })
    .where(
      and(
        messageWhere(claim.scope, claim.threadId),
        eq(chatMessage.id, claim.assistantMessageId),
        eq(chatMessage.state, "draft"),
      ),
    )
    .returning({ id: chatMessage.id })
  if (updated.length === 0) return yield* new ChatThreadConflict()
  yield* saveChatParts(db, claim.scope, claim.threadId, claim.assistantMessageId, payload)
})

const releaseChatTurn = Effect.fnUntraced(function* (
  db: Executor,
  claim: ChatWriterClaim,
  turnState: "waiting" | "completed" | "interrupted",
) {
  yield* db
    .update(chatMessage)
    .set({ turnState })
    .where(
      and(
        messageWhere(claim.scope, claim.threadId),
        eq(chatMessage.id, claim.inputMessageId),
        sql`${chatMessage.metadata}->>'invocationId' = ${claim.invocationId}`,
        eq(chatMessage.turnState, "running"),
      ),
    )
})

const acquireChatTurn = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatThreadScope,
  threadId: string,
  inputMessageId: string,
) {
  const previous = yield* readMessage(db, { scope, id: threadId }, inputMessageId)
  const invocationId = crypto.randomUUID()
  const [turn] = yield* db
    .update(chatMessage)
    .set({ turnState: "running", metadata: { ...previous.metadata, invocationId } })
    .where(
      and(
        messageWhere(scope, threadId),
        eq(chatMessage.id, inputMessageId),
        eq(chatMessage.role, "user"),
        inArray(chatMessage.turnState, ["waiting", "interrupted"]),
      ),
    )
    .returning({ id: chatMessage.id })
  if (!turn) return yield* new ChatThreadConflict()
  return invocationId
})

function executionPayload(
  payload: ChatMessagePayload,
  claim: ChatWriterClaim,
  previous: ChatMessagePayload,
): ChatMessagePayload {
  return {
    ...payload,
    turnId: claim.inputMessageId,
    invocationId: claim.invocationId,
    provenance: {
      ...previous.provenance,
      ...payload.provenance,
      initiatorTenantUserId: claim.scope.tenantUserId,
    },
  }
}

const appendDraft = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatThreadScope,
  row: ThreadRecord,
  inputMessageId: string,
  invocationId: string,
) {
  const [message] = yield* db
    .insert(chatMessage)
    .values({
      ...rowScope(scope),
      threadId: row.id,
      parentMessageId: row.currentLeafMessageId,
      role: "assistant",
      state: "draft",
      turnMessageId: inputMessageId,
      metadata: {
        version: 1,
        invocationId,
        provenance: {
          agentId: row.agentId === null ? null : `agent_${scope.organizationId}_${row.agentId}`,
          initiatorTenantUserId: scope.tenantUserId,
        },
      },
    })
    .returning()
  yield* db
    .update(chatThread)
    .set({ currentLeafMessageId: message!.id, updatedAt: sql`clock_timestamp()` })
    .where(scopeWhere(scope, row.id))
  return (yield* readChatMessages(db, scope, row.id, [message!]))[0]!
})

const historyMessages = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatReadScope,
  id: string,
  ids: readonly { id: string }[],
) {
  if (ids.length === 0) return []
  const rows = yield* db
    .select()
    .from(chatMessage)
    .where(
      and(
        messageWhere(scope, id),
        inArray(
          chatMessage.id,
          ids.map((item) => item.id),
        ),
      ),
    )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return yield* readChatMessages(
    db,
    scope,
    id,
    ids.map((item) => byId.get(item.id)!),
  )
})

const readHistoryPage = Effect.fnUntraced(function* (
  db: Executor,
  input: { scope: ChatReadScope; id: string } & DatabasePageOptions,
  leaf: string | null,
) {
  const history = yield* historyIds(db, input.scope, input.id, leaf)
  const page = yield* databasePage(input, (position, limit, backward) =>
    Effect.gen(function* () {
      if (!position) return history.slice(-limit).reverse()
      const index = history.findIndex((message) => message.id === position.id)
      if (index < 0) return yield* new ChatThreadNotFound()
      return backward
        ? history.slice(index + 1, index + 1 + limit)
        : history.slice(Math.max(0, index - limit), index).reverse()
    }),
  )
  return {
    history,
    messages: {
      ...page,
      items: yield* historyMessages(db, input.scope, input.id, page.items.reverse()),
    },
  }
})

const directoryThreadColumns = {
  ...getTableColumns(chatThread),
  tenantName: tenant.name,
  tenantExternalId: tenant.externalId,
}
const directoryTenantJoin = and(
  eq(tenant.organizationId, chatThread.organizationId),
  eq(tenant.id, chatThread.tenantId),
)
function directoryThreadWhere(scope: TenantScope) {
  return and(
    eq(chatThread.organizationId, scope.organizationId),
    scope.tenantId === undefined
      ? undefined
      : scope.tenantId === null
        ? sql`false`
        : eq(chatThread.tenantId, scope.tenantId),
  )
}
const readDirectoryThread = Effect.fnUntraced(function* (
  db: Executor,
  input: DirectoryThreadInput,
) {
  const [row] = yield* db
    .select(directoryThreadColumns)
    .from(chatThread)
    .innerJoin(tenant, directoryTenantJoin)
    .where(
      and(
        directoryThreadWhere(input.scope),
        eq(chatThread.tenantId, input.tenantId),
        eq(chatThread.id, input.id),
      ),
    )
    .limit(1)
  if (!row) return yield* new ChatThreadNotFound()
  return row
})

function toolTargets(part: Schema.JsonObject): readonly Schema.JsonObject[] {
  if (!Array.isArray(part.targets)) return []
  return (part.targets as readonly Schema.Json[]).filter(Schema.is(Schema.JsonObject))
}

const unresolvedCalls = Effect.fnUntraced(function* (
  db: Executor,
  scope: ChatThreadScope,
  thread: ThreadRecord,
  assistantMessageId?: string,
  selectedIds?: readonly { id: string }[],
) {
  const ids = selectedIds ?? (yield* historyIds(db, scope, thread.id, thread.currentLeafMessageId))
  if (!ids.length) return []
  const outstanding = yield* db
    .select({ message: chatMessage, partId: chatMessagePart.id, targetId: chatToolResponse.id })
    .from(chatToolResponse)
    .innerJoin(
      chatMessagePart,
      and(
        eq(chatMessagePart.organizationId, chatToolResponse.organizationId),
        eq(chatMessagePart.tenantId, chatToolResponse.tenantId),
        eq(chatMessagePart.threadId, chatToolResponse.threadId),
        eq(chatMessagePart.id, chatToolResponse.toolPartId),
      ),
    )
    .innerJoin(
      chatMessage,
      and(
        eq(chatMessage.organizationId, chatMessagePart.organizationId),
        eq(chatMessage.tenantId, chatMessagePart.tenantId),
        eq(chatMessage.threadId, chatMessagePart.threadId),
        eq(chatMessage.id, chatMessagePart.messageId),
      ),
    )
    .where(
      and(
        chatResponseWhere(scope, thread.id),
        isNull(chatToolResponse.resultMessageId),
        eq(chatMessage.role, "assistant"),
        eq(chatMessage.state, "complete"),
        inArray(
          chatMessage.id,
          ids.map((item) => item.id),
        ),
        assistantMessageId ? eq(chatMessage.id, assistantMessageId) : undefined,
      ),
    )
  if (!outstanding.length) return []
  const messages = [...new Map(outstanding.map(({ message }) => [message.id, message])).values()]
  const targets = new Set(outstanding.map(({ targetId }) => targetId))
  const rows = yield* readChatMessages(
    db,
    scope,
    thread.id,
    messages,
    outstanding.map(({ partId }) => partId),
  )
  return rows.flatMap((message) =>
    message.payload.parts.flatMap((part) =>
      part.type === "tool-call"
        ? toolTargets(part)
            .filter((target) => typeof target.id === "string" && targets.has(target.id))
            .map((target) => ({ message, part, target }))
        : [],
    ),
  )
})

export type PendingChatInteraction = Effect.Success<ReturnType<typeof unresolvedCalls>>[number]

const appendResults = Effect.fnUntraced(function* (
  db: Executor,
  input: ThreadInput,
  row: ThreadRecord,
  results: readonly ChatToolResolution[],
  server: boolean,
  clientId?: string,
) {
  let current = row
  let insertedSource: MessageRecord | null = null
  const pending = new Set(
    (yield* unresolvedCalls(db, input.scope, row)).map(({ message, part, target }) =>
      JSON.stringify([message.id, part.id, target.id]),
    ),
  )
  for (const result of results) {
    const [response] = yield* db
      .select()
      .from(chatToolResponse)
      .where(
        and(
          chatResponseWhere(input.scope, input.id),
          eq(chatToolResponse.id, result.responseTargetId),
          eq(chatToolResponse.toolPartId, result.toolPartId),
        ),
      )
      .for("update")
    if (!response) return yield* new ChatThreadInvalid()
    const existing = response.resultMessageId
      ? yield* readMessage(db, input, response.resultMessageId)
      : undefined
    const source = yield* readMessage(db, input, result.assistantMessageId)
    const part = source.payload.parts.find(
      (item) => item.id === result.toolPartId && item.type === "tool-call",
    )
    const target = part
      ? toolTargets(part).find((item) => item.id === result.responseTargetId)
      : undefined
    if (source.state !== "complete" || !part || !target) return yield* new ChatThreadInvalid()
    const [active] = yield* db
      .select({ id: chatMessage.id })
      .from(chatMessage)
      .where(
        and(
          messageWhere(input.scope, input.id),
          eq(chatMessage.id, source.turnMessageId!),
          eq(chatMessage.turnState, "running"),
        ),
      )
      .for("update")
    const targetUser = target.tenantUserId === input.scope.tenantUserId
    const interaction = part.name === "ask_questionnaire" || part.name === "render_widget"
    const abandon =
      result.payload.parts[0]?.outcome === "unknown" && (targetUser || row.role === "manager")
    const browserDenied =
      part.executionLocation === "browser" &&
      (server
        ? result.payload.parts[0]?.outcome !== "failed"
        : !(
            abandon ||
            (targetUser &&
              (interaction || target.clientId === undefined || target.clientId === clientId))
          ))
    const serverDenied = part.executionLocation !== "browser" && !server && !abandon
    if (browserDenied || serverDenied) return yield* new ChatThreadForbidden()
    if (existing) {
      const accepted = existing.payload.parts[0]
      const submitted = result.payload.parts[0]
      if (
        accepted?.outcome !== submitted?.outcome ||
        !isDeepStrictEqual(accepted?.output, submitted?.output)
      )
        return yield* new ChatThreadConflict()
      continue
    }
    if (!server && active) {
      if (!abandon) return yield* new ChatThreadConflict()
      yield* db
        .update(chatMessage)
        .set({ turnState: "interrupted" })
        .where(and(messageWhere(input.scope, input.id), eq(chatMessage.id, active.id)))
      yield* db
        .update(chatMessage)
        .set({ state: "interrupted" })
        .where(
          and(
            messageWhere(input.scope, input.id),
            eq(chatMessage.turnMessageId, active.id),
            eq(chatMessage.state, "draft"),
          ),
        )
    }
    if (
      !pending.has(
        JSON.stringify([result.assistantMessageId, result.toolPartId, result.responseTargetId]),
      )
    )
      return yield* new ChatThreadConflict()
    if (insertedSource && insertedSource.id !== source.id) return yield* new ChatThreadInvalid()
    if (result.payload.parts.length !== 1 || result.payload.parts[0]?.type !== "tool-result")
      return yield* new ChatThreadInvalid()
    const submitted = result.payload.parts[0]
    const payload = yield* decodePayload({
      ...result.payload,
      parts: [
        {
          ...submitted,
          toolCallId: part.toolCallId,
        },
      ],
    }).pipe(Effect.mapError(() => new ChatThreadInvalid()))
    const [message] = yield* db
      .insert(chatMessage)
      .values({
        ...rowScope(input.scope),
        threadId: input.id,
        parentMessageId: current.currentLeafMessageId,
        role: "tool",
        state: "complete",
        authorTenantUserId: server ? null : input.scope.tenantUserId,
        metadata: chatMetadata(payload),
        turnMessageId: source.turnMessageId,
      })
      .returning()
    yield* insertChatContent(db, input.scope, input.id, message!.id, payload)
    yield* db
      .update(chatToolResponse)
      .set({ resultMessageId: message!.id })
      .where(and(chatResponseWhere(input.scope, input.id), eq(chatToolResponse.id, response.id)))
    current = {
      ...current,
      currentLeafMessageId: message!.id,
    }
    insertedSource = source
  }
  if (insertedSource)
    yield* db
      .update(chatThread)
      .set({
        currentLeafMessageId: current.currentLeafMessageId,
        updatedAt: sql`clock_timestamp()`,
        lockVersion: sql`${chatThread.lockVersion} + 1`,
      })
      .where(scopeWhere(input.scope, input.id))
  return { row: current, insertedSource }
})

export class ChatThreads extends Context.Service<
  ChatThreads,
  {
    readonly directoryList: (
      input: DatabasePageOptions & { scope: TenantScope; search?: string | undefined },
    ) => Effect.Effect<DatabasePage<DirectoryThreadRecord>>
    readonly directorySnapshot: (
      input: DirectoryThreadInput & DatabasePageOptions,
    ) => Effect.Effect<
      { thread: DirectoryThreadRecord; messages: DatabasePage<MessageRecord> },
      ChatThreadNotFound
    >
    readonly directoryMessage: (
      input: DirectoryThreadInput & { messageId: string },
    ) => Effect.Effect<MessageRecord, ChatThreadNotFound>
    readonly resolveScope: (input: {
      principal: ChatPrincipal
    }) => Effect.Effect<ChatThreadScope, ChatIdentityNotSynchronized>
    readonly create: (input: {
      scope: ChatThreadScope
      agentId?: string | undefined
      title?: string | undefined
    }) => Effect.Effect<ThreadRecord, ChatThreadError>
    readonly list: (
      input: DatabasePageOptions & { scope: ChatThreadScope; search?: string | undefined },
    ) => Effect.Effect<DatabasePage<ThreadRecord>>
    readonly get: (input: ThreadInput) => Effect.Effect<ThreadRecord, ChatThreadError>
    readonly snapshot: (input: ThreadInput & DatabasePageOptions) => Effect.Effect<
      {
        thread: ThreadRecord
        messages: DatabasePage<MessageRecord>
        pending: PendingChatInteraction[]
      },
      ChatThreadError
    >
    readonly history: (
      input: ThreadInput & { messageId?: string },
    ) => Effect.Effect<MessageRecord[], ChatThreadError>
    readonly pending: (
      input: ThreadInput,
    ) => Effect.Effect<PendingChatInteraction[], ChatThreadError>
    readonly getMessage: (
      input: ThreadInput & { messageId: string },
    ) => Effect.Effect<MessageRecord, ChatThreadError>
    readonly rename: (
      input: ThreadInput & { lockVersion: number; title: string },
    ) => Effect.Effect<ThreadRecord, ChatThreadError>
    readonly remove: (
      input: ThreadInput & { lockVersion: number },
    ) => Effect.Effect<void, ChatThreadError>
    readonly participants: (
      input: ThreadInput & DatabasePageOptions,
    ) => Effect.Effect<DatabasePage<ParticipantRecord>, ChatThreadError>
    readonly setParticipant: (
      input: ThreadInput & {
        lockVersion: number
        tenantUserId: string
        role: ChatParticipantRole
      },
    ) => Effect.Effect<ParticipantRecord, ChatThreadError>
    readonly removeParticipant: (
      input: ThreadInput & { lockVersion: number; tenantUserId: string },
    ) => Effect.Effect<void, ChatThreadError>
    readonly admit: (input: AdmitInput) => Effect.Effect<ChatAdmission, ChatThreadError>
    readonly checkpoint: (input: {
      claim: ChatWriterClaim
      payload: ChatMessagePayload
      state: "draft" | "complete"
    }) => Effect.Effect<void, ChatThreadError>
    readonly assertActive: (input: {
      claim: ChatWriterClaim
    }) => Effect.Effect<void, ChatThreadError>
    readonly nextDraft: (input: {
      claim: ChatWriterClaim
    }) => Effect.Effect<ChatWriterClaim, ChatThreadError>
    readonly appendToolResults: (input: {
      claim: ChatWriterClaim
      results: readonly ChatToolResolution[]
    }) => Effect.Effect<void, ChatThreadError>
    readonly resolveTools: (
      input: ResolveToolsInput,
    ) => Effect.Effect<ChatAdmission, ChatThreadError>
    readonly finish: (input: {
      claim: ChatWriterClaim
      payload?: ChatMessagePayload | undefined
    }) => Effect.Effect<void, ChatThreadError>
    readonly interrupt: (input: { claim: ChatWriterClaim }) => Effect.Effect<void, ChatThreadError>
  }
>()("astralbeam/chat/threads/ChatThreads") {
  static readonly layerNoDeps = Layer.effect(
    ChatThreads,
    Effect.gen(function* () {
      const db = yield* Database
      const directoryList = Effect.fn("ChatThreads.directoryList")(function* (
        input: DatabasePageOptions & { scope: TenantScope; search?: string | undefined },
      ) {
        return yield* databasePage(
          input,
          (position, limit, backward) =>
            db
              .select({
                ...directoryThreadColumns,
                cursorUpdatedAt: sql<string>`${chatThread.updatedAt}::text`,
              })
              .from(chatThread)
              .innerJoin(tenant, directoryTenantJoin)
              .where(
                and(
                  directoryThreadWhere(input.scope),
                  isNotNull(chatThread.currentLeafMessageId),
                  input.search
                    ? ilike(chatThread.title, tenantSearchPattern(input.search))
                    : undefined,
                  position
                    ? sql`(${chatThread.updatedAt}, ${chatThread.tenantId}, ${chatThread.id}) ${backward ? sql`>` : sql`<`} (${position.updatedAt}::timestamptz, ${position.tenantId}::uuid, ${position.id}::uuid)`
                    : undefined,
                ),
              )
              .orderBy(
                (backward ? asc : desc)(chatThread.updatedAt),
                (backward ? asc : desc)(chatThread.tenantId),
                (backward ? asc : desc)(chatThread.id),
              )
              .limit(limit)
              .pipe(mapDatabaseErrors()),
          (row) => ({ id: row.id, tenantId: row.tenantId, updatedAt: row.cursorUpdatedAt }),
        )
      })
      const directorySnapshot = Effect.fn("ChatThreads.directorySnapshot")(
        (input: DirectoryThreadInput & DatabasePageOptions) =>
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  const thread = yield* readDirectoryThread(tx, input)
                  const { messages } = yield* readHistoryPage(
                    tx,
                    {
                      ...input,
                      scope: {
                        organizationId: input.scope.organizationId,
                        tenantId: input.tenantId,
                      },
                    },
                    thread.currentLeafMessageId,
                  )
                  return { thread, messages }
                }),
              { isolationLevel: "repeatable read", accessMode: "read only" },
            )
            .pipe(mapDatabaseErrors()),
      )
      const directoryMessage = Effect.fn("ChatThreads.directoryMessage")(
        (input: DirectoryThreadInput & { messageId: string }) =>
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  yield* readDirectoryThread(tx, input)
                  return yield* readMessage(
                    tx,
                    {
                      id: input.id,
                      scope: {
                        organizationId: input.scope.organizationId,
                        tenantId: input.tenantId,
                      },
                    },
                    input.messageId,
                  )
                }),
              { isolationLevel: "repeatable read", accessMode: "read only" },
            )
            .pipe(mapDatabaseErrors()),
      )

      const resolveScope = Effect.fn("ChatThreads.resolveScope")(function* ({
        principal,
      }: {
        principal: ChatPrincipal
      }) {
        const [row] = yield* db
          .select({ tenantId: tenant.id, tenantUserId: tenantUser.id })
          .from(tenant)
          .innerJoin(
            tenantUser,
            and(
              eq(tenantUser.organizationId, tenant.organizationId),
              eq(tenantUser.tenantId, tenant.id),
              eq(tenantUser.externalId, principal.tenantUser.id),
            ),
          )
          .where(
            and(
              eq(tenant.organizationId, principal.organization.id),
              eq(tenant.externalId, principal.tenantUser.tenant.id),
            ),
          )
          .limit(1)
        if (!row) return yield* new ChatIdentityNotSynchronized()
        return { organizationId: principal.organization.id, ...row }
      }, mapDatabaseErrors())

      const create = Effect.fn("ChatThreads.create")(function* (input: {
        scope: ChatThreadScope
        agentId?: string | undefined
        title?: string | undefined
      }) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const parsed = input.agentId ? parseAgentId(input.agentId) : null
            if (input.agentId && parsed?.organizationId !== input.scope.organizationId)
              return yield* new ChatThreadNotFound()
            const [chosen] = yield* tx
              .select({ id: agent.id })
              .from(agent)
              .leftJoin(
                organizationConfiguration,
                eq(organizationConfiguration.organizationId, agent.organizationId),
              )
              .where(
                and(
                  eq(agent.organizationId, input.scope.organizationId),
                  parsed
                    ? eq(agent.id, parsed.id)
                    : eq(agent.id, organizationConfiguration.defaultAgentId),
                ),
              )
              .limit(1)
            if (!chosen) return yield* new ChatThreadNotFound()
            const [created] = yield* tx
              .insert(chatThread)
              .values({
                ...rowScope(input.scope),
                agentId: chosen.id,
                title: input.title ?? "",
              })
              .returning()
            yield* tx.insert(chatParticipant).values({
              ...rowScope(input.scope),
              threadId: created!.id,
              tenantUserId: input.scope.tenantUserId,
              role: "manager",
            })
            return yield* readThread(tx, { scope: input.scope, id: created!.id })
          }),
        )
      }, mapDatabaseErrors())

      const list = Effect.fn("ChatThreads.list")(function* (
        input: DatabasePageOptions & { scope: ChatThreadScope; search?: string | undefined },
      ) {
        return yield* databasePage(
          input,
          (position, limit, backward) =>
            db
              .select({
                ...getTableColumns(chatThread),
                role: chatParticipant.role,
                writerActive: threadExecutionActive,
                cursorUpdatedAt: sql<string>`${chatThread.updatedAt}::text`,
              })
              .from(chatThread)
              .innerJoin(
                chatParticipant,
                and(
                  eq(chatParticipant.organizationId, chatThread.organizationId),
                  eq(chatParticipant.tenantId, chatThread.tenantId),
                  eq(chatParticipant.threadId, chatThread.id),
                  eq(chatParticipant.tenantUserId, input.scope.tenantUserId),
                ),
              )
              .where(
                and(
                  eq(chatThread.organizationId, input.scope.organizationId),
                  eq(chatThread.tenantId, input.scope.tenantId),
                  isNotNull(chatThread.currentLeafMessageId),
                  input.search
                    ? ilike(chatThread.title, tenantSearchPattern(input.search))
                    : undefined,
                  position
                    ? sql`(${chatThread.updatedAt}, ${chatThread.id}) ${backward ? sql`>` : sql`<`} (${position.updatedAt}::timestamptz, ${position.id}::uuid)`
                    : undefined,
                ),
              )
              .orderBy(
                (backward ? asc : desc)(chatThread.updatedAt),
                (backward ? asc : desc)(chatThread.id),
              )
              .limit(limit)
              .pipe(mapDatabaseErrors()),
          (row) => ({ id: row.id, updatedAt: row.cursorUpdatedAt }),
        )
      })

      const get = Effect.fn("ChatThreads.get")((input: ThreadInput) =>
        readThread(db, input).pipe(mapDatabaseErrors()),
      )

      const history = Effect.fn("ChatThreads.history")(
        (input: ThreadInput & { messageId?: string }) =>
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  const thread = yield* readThread(tx, input)
                  return yield* historyMessages(
                    tx,
                    input.scope,
                    input.id,
                    yield* historyIds(
                      tx,
                      input.scope,
                      input.id,
                      input.messageId ?? thread.currentLeafMessageId,
                    ),
                  )
                }),
              { isolationLevel: "repeatable read", accessMode: "read only" },
            )
            .pipe(mapDatabaseErrors()),
      )
      const pending = Effect.fn("ChatThreads.pending")((input: ThreadInput) =>
        db
          .transaction(
            (tx) =>
              Effect.gen(function* () {
                return yield* unresolvedCalls(tx, input.scope, yield* readThread(tx, input))
              }),
            { isolationLevel: "repeatable read", accessMode: "read only" },
          )
          .pipe(mapDatabaseErrors()),
      )
      const snapshot = Effect.fn("ChatThreads.snapshot")(
        (input: ThreadInput & DatabasePageOptions) =>
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  const thread = yield* readThread(tx, input)
                  const { history, messages } = yield* readHistoryPage(
                    tx,
                    input,
                    thread.currentLeafMessageId,
                  )
                  return {
                    thread,
                    messages,
                    pending: yield* unresolvedCalls(tx, input.scope, thread, undefined, history),
                  }
                }),
              { isolationLevel: "repeatable read", accessMode: "read only" },
            )
            .pipe(mapDatabaseErrors()),
      )
      const getMessage = Effect.fn("ChatThreads.getMessage")(function* (
        input: ThreadInput & { messageId: string },
      ) {
        yield* readThread(db, input)
        return yield* readMessage(db, input, input.messageId)
      }, mapDatabaseErrors())

      const rename = Effect.fn("ChatThreads.rename")(
        (input: ThreadInput & { lockVersion: number; title: string }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const row = yield* readThread(tx, input, true)
                yield* requireRole(row, true)
                yield* updateWithOptimisticLock({
                  executor: tx,
                  table: chatThread,
                  id: input.id,
                  scope: scopeWhere(input.scope, input.id),
                  expectedLockVersion: input.lockVersion,
                  set: { title: input.title },
                }).pipe(Effect.catchTag("OptimisticLockError", () => new ChatThreadConflict()))
                return yield* readThread(tx, input)
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      const remove = Effect.fn("ChatThreads.remove")(
        (input: ThreadInput & { lockVersion: number }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const row = yield* readThread(tx, input, true)
                yield* requireRole(row, true)
                yield* tx
                  .update(chatThread)
                  .set({ currentLeafMessageId: null })
                  .where(scopeWhere(input.scope, input.id))
                yield* deleteWithOptimisticLock({
                  executor: tx,
                  table: chatThread,
                  id: input.id,
                  scope: scopeWhere(input.scope, input.id),
                  expectedLockVersion: input.lockVersion,
                }).pipe(Effect.catchTag("OptimisticLockError", () => new ChatThreadConflict()))
                yield* tx
                  .delete(cacheEntry)
                  .where(
                    and(
                      eq(cacheEntry.namespace, "chat"),
                      like(cacheEntry.key, `${row.organizationId}:${row.tenantId}:${row.id}:%`),
                    ),
                  )
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      const participants = Effect.fn("ChatThreads.participants")(function* (
        input: ThreadInput & DatabasePageOptions,
      ) {
        yield* readThread(db, input)
        return yield* databasePage(input, (position, limit, backward) =>
          db
            .select({
              ...getTableColumns(chatParticipant),
              name: tenantUser.name,
              externalId: tenantUser.externalId,
              metadata: tenantUser.metadata,
            })
            .from(chatParticipant)
            .innerJoin(
              tenantUser,
              and(
                eq(tenantUser.organizationId, chatParticipant.organizationId),
                eq(tenantUser.tenantId, chatParticipant.tenantId),
                eq(tenantUser.id, chatParticipant.tenantUserId),
              ),
            )
            .where(
              and(
                participantWhere(input.scope, input.id),
                position ? (backward ? lt : gt)(chatParticipant.id, position.id) : undefined,
              ),
            )
            .orderBy((backward ? desc : asc)(chatParticipant.id))
            .limit(limit)
            .pipe(
              Effect.map((rows) =>
                rows.map(({ metadata, ...row }) => ({
                  ...row,
                  email: tenantUserEmail({ metadata, externalId: row.externalId }),
                })),
              ),
              mapDatabaseErrors(),
            ),
        )
      }, mapDatabaseErrors())

      const changeParticipant = Effect.fnUntraced(function* (
        input: ThreadInput & {
          lockVersion: number
          tenantUserId: string
          role?: ChatParticipantRole | undefined
        },
      ) {
        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const row = yield* readThread(tx, input, true)
            yield* requireRole(row, true)
            yield* updateWithOptimisticLock({
              executor: tx,
              table: chatThread,
              id: input.id,
              scope: scopeWhere(input.scope, input.id),
              expectedLockVersion: input.lockVersion,
              set: {},
            }).pipe(Effect.catchTag("OptimisticLockError", () => new ChatThreadConflict()))
            const [person] = yield* tx
              .select({
                id: tenantUser.id,
                name: tenantUser.name,
                externalId: tenantUser.externalId,
                metadata: tenantUser.metadata,
              })
              .from(tenantUser)
              .where(
                and(
                  eq(tenantUser.organizationId, input.scope.organizationId),
                  eq(tenantUser.tenantId, input.scope.tenantId),
                  eq(tenantUser.id, input.tenantUserId),
                ),
              )
              .limit(1)
            if (!person) return yield* new ChatThreadNotFound()
            const [previous] = yield* tx
              .select({ role: chatParticipant.role })
              .from(chatParticipant)
              .where(
                and(
                  participantWhere(input.scope, input.id),
                  eq(chatParticipant.tenantUserId, input.tenantUserId),
                ),
              )
              .limit(1)
            if (previous?.role === "manager" && input.role !== "manager") {
              const [managers] = yield* tx
                .select({ count: count() })
                .from(chatParticipant)
                .where(
                  and(participantWhere(input.scope, input.id), eq(chatParticipant.role, "manager")),
                )
              if (managers!.count === 1) return yield* new ChatThreadConflict()
            }
            let result: ParticipantRecord | undefined
            if (input.role) {
              const [saved] = yield* tx
                .insert(chatParticipant)
                .values({
                  ...rowScope(input.scope),
                  threadId: input.id,
                  tenantUserId: input.tenantUserId,
                  role: input.role,
                })
                .onConflictDoUpdate({
                  target: [
                    chatParticipant.organizationId,
                    chatParticipant.tenantId,
                    chatParticipant.threadId,
                    chatParticipant.tenantUserId,
                  ],
                  set: { role: input.role },
                })
                .returning()
              result = {
                ...saved!,
                name: person.name,
                externalId: person.externalId,
                email: tenantUserEmail(person),
              }
            } else
              yield* tx
                .delete(chatParticipant)
                .where(
                  and(
                    participantWhere(input.scope, input.id),
                    eq(chatParticipant.tenantUserId, input.tenantUserId),
                  ),
                )
            if (input.role === undefined || input.role === "viewer") {
              const turns = yield* tx
                .update(chatMessage)
                .set({ turnState: "interrupted" })
                .where(
                  and(
                    messageWhere(input.scope, input.id),
                    eq(chatMessage.turnState, "running"),
                    sql`exists (select 1 from chat_message output
                      where output.organization_id = ${chatMessage.organizationId}
                        and output.tenant_id = ${chatMessage.tenantId}
                        and output.thread_id = ${chatMessage.threadId}
                        and output.turn_message_id = ${chatMessage.id}
                        and output.role = 'assistant'
                        and output.metadata->>'invocationId' = ${chatMessage.metadata}->>'invocationId'
                        and output.metadata->'provenance'->>'initiatorTenantUserId' = ${input.tenantUserId})`,
                  ),
                )
                .returning({ id: chatMessage.id })
              if (turns.length)
                yield* tx
                  .update(chatMessage)
                  .set({ state: "interrupted" })
                  .where(
                    and(
                      messageWhere(input.scope, input.id),
                      eq(chatMessage.state, "draft"),
                      inArray(
                        chatMessage.turnMessageId,
                        turns.map((turn) => turn.id),
                      ),
                    ),
                  )
            }
            return result
          }),
        )
      }, mapDatabaseErrors())
      const setParticipant = Effect.fn("ChatThreads.setParticipant")(
        (
          input: ThreadInput & {
            lockVersion: number
            tenantUserId: string
            role: ChatParticipantRole
          },
        ) => changeParticipant(input).pipe(Effect.map((row) => row!)),
      )
      const removeParticipant = Effect.fn("ChatThreads.removeParticipant")(
        (input: ThreadInput & { lockVersion: number; tenantUserId: string }) =>
          changeParticipant(input).pipe(Effect.asVoid),
      )

      const admit = Effect.fn("ChatThreads.admit")((input: AdmitInput) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* readThread(tx, input, true)
              yield* requireRole(row)
              if (!row.agentId) return yield* new ChatThreadConflict()
              const payload = yield* decodePayload(input.payload).pipe(
                Effect.mapError(() => new ChatThreadInvalid()),
              )
              const attachmentBytes = payload.parts.reduce((total, part) => {
                const source = part.source
                return (
                  total +
                  (Schema.is(Schema.JsonObject)(source) && typeof source.value === "string"
                    ? base64ByteLength(source.value)
                    : 0)
                )
              }, 0)
              if (attachmentBytes > 0) {
                // Enforce the restored run budget under the append lock, counting encodings in SQL
                // so concurrent uploads cannot persist a history that normalizeChatAttachments rejects.
                const ids = yield* historyIds(tx, input.scope, input.id, row.currentLeafMessageId)
                const [saved] = ids.length
                  ? yield* tx
                      .select({
                        bytes:
                          sql<number>`coalesce(sum(length(encoded.value) * 3 / 4 - length(encoded.value) + length(rtrim(encoded.value, '='))), 0)`.mapWith(
                            Number,
                          ),
                      })
                      .from(chatMessagePart)
                      .innerJoin(
                        chatMessage,
                        and(
                          eq(chatMessage.organizationId, chatMessagePart.organizationId),
                          eq(chatMessage.tenantId, chatMessagePart.tenantId),
                          eq(chatMessage.threadId, chatMessagePart.threadId),
                          eq(chatMessage.id, chatMessagePart.messageId),
                        ),
                      )
                      .crossJoin(
                        sql`lateral (select regexp_replace(${chatMessagePart.payload} #>> '{source,value}', '^data:[^,]*,|[[:space:]]', '', 'g') as value) encoded`,
                      )
                      .where(
                        and(
                          chatPartWhere(input.scope, input.id),
                          eq(chatMessage.role, "user"),
                          sql`${chatMessagePart.payload}->>'type' in ('image', 'document', 'audio', 'video')`,
                          inArray(
                            chatMessagePart.messageId,
                            ids.map((item) => item.id),
                          ),
                        ),
                      )
                  : []
                if (attachmentBytes + (saved?.bytes ?? 0) > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
                  return yield* new ChatThreadInvalid()
              }
              const invocationId = crypto.randomUUID()
              const [userMessage] = yield* tx
                .insert(chatMessage)
                .values({
                  ...rowScope(input.scope),
                  threadId: input.id,
                  parentMessageId: row.currentLeafMessageId,
                  role: "user",
                  state: "complete",
                  authorTenantUserId: input.scope.tenantUserId,
                  metadata: chatMetadata({ ...payload, invocationId }),
                  turnState: "running",
                })
                .returning()
              yield* insertChatContent(tx, input.scope, input.id, userMessage!.id, payload)
              const assistantMessage = yield* appendDraft(
                tx,
                input.scope,
                { ...row, currentLeafMessageId: userMessage!.id },
                userMessage!.id,
                invocationId,
              )
              const text = payload.parts
                .flatMap((part) =>
                  part.type === "text" && typeof part.content === "string" ? [part.content] : [],
                )
                .join(" ")
                .replace(/\s+/gu, " ")
                .trim()
              const initialTitle =
                row.currentLeafMessageId === null && !row.title.trim()
                  ? Array.from(text).slice(0, 80).join("") || "Conversation"
                  : row.title
              yield* tx
                .update(chatThread)
                .set({
                  title: initialTitle,
                  lockVersion: sql`${chatThread.lockVersion} + 1`,
                  updatedAt: sql`clock_timestamp()`,
                })
                .where(scopeWhere(input.scope, input.id))
              return {
                thread: yield* readThread(tx, input),
                inputMessage: (yield* readChatMessages(tx, input.scope, input.id, [
                  userMessage!,
                ]))[0]!,
                assistantMessage,
                claim: {
                  scope: input.scope,
                  threadId: input.id,
                  assistantMessageId: assistantMessage.id,
                  inputMessageId: userMessage!.id,
                  invocationId,
                },
              }
            }),
          )
          .pipe(mapDatabaseErrors()),
      )

      const checkpoint = Effect.fn("ChatThreads.checkpoint")(
        (input: {
          claim: ChatWriterClaim
          payload: ChatMessagePayload
          state: "draft" | "complete"
        }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const { message } = yield* checkClaim(tx, input.claim)
                yield* persistChatOutput(tx, input.claim, message, input.payload, input.state)
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      const assertActive = Effect.fn("ChatThreads.assertActive")(
        ({ claim }: { claim: ChatWriterClaim }) =>
          db
            .transaction((tx) => checkClaim(tx, claim).pipe(Effect.asVoid))
            .pipe(mapDatabaseErrors()),
      )

      const nextDraft = Effect.fn("ChatThreads.nextDraft")(
        ({ claim }: { claim: ChatWriterClaim }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const { thread: row, message: previous } = yield* checkClaim(tx, claim)
                if (
                  previous.state !== "complete" ||
                  (yield* unresolvedCalls(tx, claim.scope, row, claim.assistantMessageId)).length >
                    0
                )
                  return yield* new ChatThreadConflict()
                const message = yield* appendDraft(
                  tx,
                  claim.scope,
                  row,
                  claim.inputMessageId,
                  claim.invocationId,
                )
                return { ...claim, assistantMessageId: message.id }
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      const appendToolResults = Effect.fn("ChatThreads.appendToolResults")(
        ({ claim, results }: { claim: ChatWriterClaim; results: readonly ChatToolResolution[] }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const { thread: row } = yield* checkClaim(tx, claim)
                if (
                  results.some((result) => result.assistantMessageId !== claim.assistantMessageId)
                )
                  return yield* new ChatThreadConflict()
                yield* appendResults(
                  tx,
                  { scope: claim.scope, id: claim.threadId },
                  row,
                  results,
                  true,
                )
              }),
            )
            .pipe(Effect.asVoid, mapDatabaseErrors()),
      )

      const resolveTools = Effect.fn("ChatThreads.resolveTools")((input: ResolveToolsInput) =>
        db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* readThread(tx, input, true)
              yield* requireRole(row)
              if (input.results.length === 0) return yield* new ChatThreadInvalid()
              const result = yield* appendResults(
                tx,
                input,
                row,
                input.results,
                false,
                input.clientId,
              )
              const source =
                result.insertedSource ??
                (yield* readMessage(tx, input, input.results[0]!.assistantMessageId))
              const turnId = source.payload.turnId
              if (!turnId) return yield* new ChatThreadInvalid()
              const userMessage = yield* readMessage(tx, input, turnId)
              if (
                !result.insertedSource ||
                (yield* unresolvedCalls(tx, input.scope, result.row)).some(
                  ({ message }) => message.turnMessageId === turnId,
                )
              )
                return {
                  thread: yield* readThread(tx, input),
                  inputMessage: userMessage,
                  assistantMessage: null,
                  claim: null,
                }
              const invocationId = yield* acquireChatTurn(tx, input.scope, input.id, turnId)
              const assistantMessage = yield* appendDraft(
                tx,
                input.scope,
                result.row,
                turnId,
                invocationId,
              )
              return {
                thread: yield* readThread(tx, input),
                inputMessage: userMessage,
                assistantMessage,
                claim: {
                  scope: input.scope,
                  threadId: input.id,
                  assistantMessageId: assistantMessage.id,
                  inputMessageId: userMessage.id,
                  invocationId,
                },
              }
            }),
          )
          .pipe(mapDatabaseErrors()),
      )

      const finish = Effect.fn("ChatThreads.finish")(
        ({
          claim,
          payload,
        }: {
          claim: ChatWriterClaim
          payload?: ChatMessagePayload | undefined
        }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const { message, thread } = yield* checkClaim(tx, claim)
                if (message.state === "draft")
                  yield* persistChatOutput(
                    tx,
                    claim,
                    message,
                    payload ?? message.payload,
                    "complete",
                  )
                const pending = (yield* unresolvedCalls(tx, claim.scope, thread)).some(
                  ({ message: source }) => source.turnMessageId === claim.inputMessageId,
                )
                yield* releaseChatTurn(tx, claim, pending ? "waiting" : "completed")
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      const interrupt = Effect.fn("ChatThreads.interrupt")(
        ({ claim }: { claim: ChatWriterClaim }) =>
          db
            .transaction((tx) =>
              Effect.gen(function* () {
                const active = yield* checkClaim(tx, claim).pipe(
                  Effect.catchTags({
                    ChatThreadNotFound: () => Effect.succeed(null),
                    ChatThreadForbidden: () => Effect.succeed(null),
                    ChatThreadConflict: () => Effect.succeed(null),
                  }),
                )
                if (!active) return
                yield* tx
                  .update(chatMessage)
                  .set({ state: "interrupted" })
                  .where(
                    and(
                      messageWhere(claim.scope, claim.threadId),
                      eq(chatMessage.turnMessageId, claim.inputMessageId),
                      eq(chatMessage.state, "draft"),
                    ),
                  )
                yield* releaseChatTurn(tx, claim, "interrupted")
              }),
            )
            .pipe(mapDatabaseErrors()),
      )

      return ChatThreads.of({
        directoryList,
        directorySnapshot,
        directoryMessage,
        resolveScope,
        create,
        list,
        get,
        snapshot,
        history,
        pending,
        getMessage,
        rename,
        remove,
        participants,
        setParticipant,
        removeParticipant,
        admit,
        checkpoint,
        assertActive,
        nextDraft,
        appendToolResults,
        resolveTools,
        finish,
        interrupt,
      })
    }),
  )
  static readonly layer = ChatThreads.layerNoDeps.pipe(Layer.provide(Database.layer))
}
