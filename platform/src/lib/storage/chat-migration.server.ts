import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { cacheEntry } from "@/db/schema/cache.server"
import { chatMessage, chatMessagePart } from "@/db/schema/chat.server"
import { ChatFiles, mapChatPayloadMedia } from "@/lib/chat/attachments/chat-files.server"
import { chatMediaPart, storedChatMediaSource } from "@/lib/chat/attachments/stored-media"
import { ChatThreadInvalid } from "@/lib/chat/threads/errors"
import { ChatMessagePayloadSchema, ChatSubmissionReceiptSchema } from "@/lib/chat/threads/schemas"
import { ApiUuidSchema } from "@/lib/tenants/schemas"
import { Option } from "effect"

const chatMigrationTables = [
  "chat_message_part.payload",
  "chat_message.metadata.modelMessages",
  "cache_entry.value",
] as const
export type ChatMigrationTable = (typeof chatMigrationTables)[number]
export function isChatMigrationTable(table: string): table is ChatMigrationTable {
  return chatMigrationTables.some((candidate) => candidate === table)
}
const chatAdmissionMigrationRecord = Schema.Struct({
  operation: Schema.String,
  parameters: Schema.Struct({
    id: ApiUuidSchema,
    parts: Schema.Array(Schema.JsonObject),
    tools: Schema.Array(Schema.JsonObject),
    clientId: ApiUuidSchema,
    agentId: Schema.optionalKey(Schema.String),
  }),
  outcome: Schema.Json,
})

const migrateChatAdmissionCache = Effect.fn("migrateChatAdmissionCache")(function* (
  mode: "inventory" | "migrate" | "verify",
) {
  const db = yield* Database
  const files = yield* ChatFiles
  const counts = { rows: 0, embedded: 0, stored: 0, unsupported: 0, migrated: 0, verified: 0 }

  let cursor: string | undefined
  while (true) {
    const rows = yield* db
      .select()
      .from(cacheEntry)
      .where(
        and(
          eq(cacheEntry.namespace, "chat"),
          cursor ? sql`${cacheEntry.id} > ${cursor}::uuid` : undefined,
        ),
      )
      .orderBy(asc(cacheEntry.id))
      .limit(100)
      .pipe(mapDatabaseErrors())
    if (!rows.length) break
    for (const row of rows) {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(row.value) as unknown,
        catch: () => new ChatThreadInvalid(),
      })
      if (
        !Schema.is(Schema.JsonObject)(parsed) ||
        !["ChatAdmission/v1", "ChatAdmission/v2"].includes(
          typeof parsed.operation === "string" ? parsed.operation : "",
        )
      )
        continue
      counts.rows++
      const record = yield* Schema.decodeUnknownEffect(chatAdmissionMigrationRecord)(parsed).pipe(
        Effect.mapError(() => new ChatThreadInvalid()),
      )
      yield* Schema.decodeUnknownEffect(
        Schema.toCodecJson(Schema.Result(ChatSubmissionReceiptSchema, Schema.Never)),
      )(record.outcome).pipe(Effect.mapError(() => new ChatThreadInvalid()))
      if (record.operation === "ChatAdmission/v2") {
        counts.stored++
        continue
      }
      counts.embedded++
      if (mode === "inventory") continue
      if (mode === "verify") return yield* new ChatThreadInvalid()
      const [organizationId, tenantId, threadId, tenantUserId, keyHash, extra] = row.key.split(":")
      for (const id of [organizationId, tenantId, threadId, tenantUserId])
        yield* Schema.decodeUnknownEffect(ApiUuidSchema)(id).pipe(
          Effect.mapError(() => new ChatThreadInvalid()),
        )
      if (
        extra !== undefined ||
        !keyHash ||
        !/^[0-9a-f]{64}$/.test(keyHash) ||
        threadId !== record.parameters.id
      )
        return yield* new ChatThreadInvalid()
      const parts = yield* files.identity(
        { organizationId: organizationId!, tenantId: tenantId!, threadId },
        record.parameters.parts,
      )
      const changed = yield* db
        .update(cacheEntry)
        .set({
          value: JSON.stringify({
            ...record,
            operation: "ChatAdmission/v2",
            parameters: { ...record.parameters, parts },
          }),
        })
        .where(and(eq(cacheEntry.id, row.id), eq(cacheEntry.value, row.value)))
        .returning({ id: cacheEntry.id })
        .pipe(mapDatabaseErrors())
      counts.migrated += changed.length
    }
    cursor = rows.at(-1)!.id
  }

  console.log("cache_entry.value", counts)
  return counts
})

export const migrateChatFiles = Effect.fn("migrateChatFiles")(function* (
  tableName: ChatMigrationTable,
  mode: "inventory" | "migrate" | "verify",
) {
  if (tableName === "cache_entry.value") return yield* migrateChatAdmissionCache(mode)
  const db = yield* Database
  const files = yield* ChatFiles
  const counts = { rows: 0, embedded: 0, stored: 0, unsupported: 0, migrated: 0, verified: 0 }

  const table = tableName === "chat_message_part.payload" ? chatMessagePart : chatMessage
  let cursor: readonly string[] | undefined
  while (true) {
    const rows = yield* db
      .select({
        organizationId: table.organizationId,
        tenantId: table.tenantId,
        threadId: table.threadId,
        id: table.id,
        content:
          tableName === "chat_message_part.payload"
            ? chatMessagePart.payload
            : chatMessage.metadata,
      })
      .from(table)
      .where(
        cursor
          ? sql`(${table.organizationId}, ${table.tenantId}, ${table.threadId}, ${table.id}) > (${cursor[0]}::uuid, ${cursor[1]}::uuid, ${cursor[2]}::uuid, ${cursor[3]}::uuid)`
          : undefined,
      )
      .orderBy(asc(table.organizationId), asc(table.tenantId), asc(table.threadId), asc(table.id))
      .limit(100)
      .pipe(mapDatabaseErrors())
    if (!rows.length) break
    for (const row of rows) {
      counts.rows++
      const isPart = tableName === "chat_message_part.payload"
      const payload = yield* Schema.decodeUnknownEffect(ChatMessagePayloadSchema)(
        isPart
          ? { version: 1, parts: [{ ...row.content, id: row.id }] }
          : { ...row.content, parts: [] },
      ).pipe(Effect.mapError(() => new ChatThreadInvalid()))
      let embedded = 0,
        stored = 0,
        unsupported = 0
      yield* mapChatPayloadMedia(payload, (part) => {
        if (chatMediaPart(part)) {
          if (Option.isSome(storedChatMediaSource(part))) stored++
          else if (Schema.is(Schema.JsonObject)(part.source) && part.source.type === "data")
            embedded++
          else unsupported++
        }
        return Effect.succeed(part)
      })
      if (
        !isPart &&
        payload.modelMessages?.some(
          (message) =>
            message.content !== null &&
            typeof message.content !== "string" &&
            !Array.isArray(message.content),
        )
      )
        unsupported++
      counts.embedded += embedded
      counts.stored += stored
      counts.unsupported += unsupported
      if (unsupported)
        yield* Effect.logWarning("Historical chat media structure is unsupported", {
          table: tableName,
          organizationId: row.organizationId,
          tenantId: row.tenantId,
          threadId: row.threadId,
          id: row.id,
          count: unsupported,
        })
      if (mode === "inventory") continue
      const scope = {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        threadId: row.threadId,
      }
      if (mode === "verify") {
        if (embedded) return yield* new ChatThreadInvalid()
        yield* files.hydrate(scope, payload)
        counts.verified += stored
        continue
      }
      if (!embedded) continue
      const prepared = yield* files.externalize(scope, payload)
      const column = isPart ? chatMessagePart.payload : chatMessage.metadata
      const value = isPart
        ? Object.fromEntries(Object.entries(prepared.parts[0]!).filter(([key]) => key !== "id"))
        : { ...row.content, modelMessages: prepared.modelMessages }
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const predicate = and(
              eq(table.organizationId, row.organizationId),
              eq(table.tenantId, row.tenantId),
              eq(table.threadId, row.threadId),
              eq(table.id, row.id),
              sql`${column} = ${JSON.stringify(row.content)}::jsonb`,
            )
            const updated = isPart
              ? yield* tx
                  .update(chatMessagePart)
                  .set({ payload: value as typeof chatMessagePart.$inferInsert.payload })
                  .where(predicate)
                  .returning({ id: chatMessagePart.id })
              : yield* tx
                  .update(chatMessage)
                  .set({ metadata: value as typeof chatMessage.$inferInsert.metadata })
                  .where(predicate)
                  .returning({ id: chatMessage.id })
            if (!updated.length) return
            yield* files.claim(tx, scope, prepared)
            counts.migrated++
          }),
        )
        .pipe(mapDatabaseErrors())
    }
    const last = rows.at(-1)!
    cursor = [last.organizationId, last.tenantId, last.threadId, last.id]
  }
  console.log(tableName, counts)
  return counts
})
