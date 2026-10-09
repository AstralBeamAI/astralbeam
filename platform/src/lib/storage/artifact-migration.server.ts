import { and, asc, eq, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"

import { Database } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { chatMessage, chatMessagePart } from "@/db/schema/chat.server"
import { tenant } from "@/db/schema/organizations.server"
import { ChatFiles, chatFileIdentityPrefix } from "@/lib/chat/attachments/chat-files.server"
import { ChatSandboxes } from "@/lib/chat/sandbox/sandbox.server"
import { ChatThreadInvalid, ChatThreadStorageUnavailable } from "@/lib/chat/threads/errors"
import { APP_HANDLE } from "@/lib/constants"
import { fileSha256 } from "./images"
import { StoredFiles } from "./stored-files.server"
import { ApiUuidSchema } from "@/lib/tenants/schemas"

// Rewrite only the documented sandbox tool result, leaving opaque provider context intact.
export function replaceArtifactContinuation(
  metadata: typeof chatMessage.$inferSelect.metadata,
  ticket: string,
  output: Schema.JsonObject,
) {
  if (!metadata.modelMessages) return metadata
  const modelMessages = metadata.modelMessages.map((message) => {
    if (
      !Schema.is(Schema.JsonObject)(message) ||
      message.role !== "tool" ||
      typeof message.content !== "string"
    )
      return message
    const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject))(
      message.content,
    )
    return Option.isSome(parsed) && parsed.value.ticket === ticket
      ? { ...message, content: JSON.stringify(output) }
      : message
  })
  return modelMessages.every((message, index) => message === metadata.modelMessages![index])
    ? metadata
    : { ...metadata, modelMessages }
}

export const migrateSandboxArtifacts = Effect.fn("migrateSandboxArtifacts")(function* (
  mode: "inventory" | "migrate" | "verify",
) {
  const db = yield* Database
  const files = yield* ChatFiles
  const storedFiles = yield* StoredFiles
  const sandboxes = yield* ChatSandboxes
  const counts = {
    rows: 0,
    historical: 0,
    stored: 0,
    unavailable: 0,
    unsupported: 0,
    migrated: 0,
    verified: 0,
  }
  let cursor: readonly string[] | undefined
  while (true) {
    const rows = yield* db
      .select({
        organizationId: chatMessagePart.organizationId,
        tenantId: chatMessagePart.tenantId,
        threadId: chatMessagePart.threadId,
        id: chatMessagePart.id,
        messageId: chatMessage.id,
        payload: chatMessagePart.payload,
        externalTenantId: tenant.externalId,
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
      .innerJoin(
        tenant,
        and(
          eq(tenant.organizationId, chatMessagePart.organizationId),
          eq(tenant.id, chatMessagePart.tenantId),
        ),
      )
      .where(
        and(
          sql`(${chatMessagePart.payload}->>'type' = 'tool-result' and exists (select 1 from chat_tool_response response join chat_message_part source on source.organization_id = response.organization_id and source.tenant_id = response.tenant_id and source.thread_id = response.thread_id and source.id = response.tool_part_id where response.result_message_id = ${chatMessage.id} and source.organization_id = ${chatMessage.organizationId} and source.tenant_id = ${chatMessage.tenantId} and source.thread_id = ${chatMessage.threadId} and source.payload->>'name' = 'sandbox_publish_artifact' and source.execution_location = 'sandbox'))`,
          cursor
            ? sql`(${chatMessagePart.organizationId}, ${chatMessagePart.tenantId}, ${chatMessagePart.threadId}, ${chatMessagePart.id}) > (${cursor[0]}::uuid, ${cursor[1]}::uuid, ${cursor[2]}::uuid, ${cursor[3]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(
        asc(chatMessagePart.organizationId),
        asc(chatMessagePart.tenantId),
        asc(chatMessagePart.threadId),
        asc(chatMessagePart.id),
      )
      .limit(100)
      .pipe(mapDatabaseErrors())
    if (!rows.length) break
    for (const row of rows) {
      counts.rows++
      const parsedOutput = Schema.decodeUnknownOption(Schema.JsonObject)(row.payload.output)
      const scope = {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        threadId: row.threadId,
      }
      if (Option.isNone(parsedOutput) || row.payload.outcome !== "succeeded") {
        counts.unsupported++
        yield* Effect.logWarning("Historical artifact structure is unsupported", {
          ...scope,
          partId: row.id,
        })
        continue
      }
      const output = parsedOutput.value
      if (output.availability === "unavailable") {
        counts.unavailable++
        continue
      }
      const fileId = Schema.decodeUnknownOption(ApiUuidSchema)(output.fileId)
      if (Option.isSome(fileId)) {
        counts.stored++
        if (mode === "verify") {
          yield* files.read(scope, fileId.value)
          counts.verified++
        }
        continue
      }
      if (typeof output.ticket !== "string") {
        counts.unsupported++
        continue
      }
      counts.historical++
      if (mode === "inventory") continue
      if (mode === "verify") return yield* new ChatThreadInvalid()
      const ticket = output.ticket
      const artifact = yield* sandboxes
        .readHistoricalArtifact({
          ticket,
          organizationId: row.organizationId,
          tenantId: row.externalTenantId,
        })
        .pipe(
          Effect.map((value) => ({ available: true as const, value })),
          Effect.catchTag("ChatArtifactUnavailable", (error) =>
            Effect.succeed({ available: false as const, reason: error.reason }),
          ),
        )
      const { ticket: _ticket, ...original } = output
      const prepared = artifact.available
        ? yield* storedFiles
            .prepare({
              bytes: artifact.value.bytes,
              contentType: artifact.value.mimeType,
              sourceIdentity: `${chatFileIdentityPrefix(scope)}${yield* fileSha256(artifact.value.bytes)}:${artifact.value.mimeType}`,
            })
            .pipe(Effect.mapError(() => new ChatThreadStorageUnavailable()))
        : undefined
      const updatedOutput: Schema.JsonObject = prepared
        ? {
            ...original,
            fileId: prepared.id,
            availability: "available",
          }
        : {
            ...original,
            availability: "unavailable",
            reason: artifact.available ? "Moved" : artifact.reason,
          }
      const changed = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const continuations = yield* tx
              .select()
              .from(chatMessage)
              .where(
                and(
                  eq(chatMessage.organizationId, row.organizationId),
                  eq(chatMessage.tenantId, row.tenantId),
                  eq(chatMessage.threadId, row.threadId),
                ),
              )
              .for("update")
            if (!continuations.some((message) => message.id === row.messageId)) return false
            const [part] = yield* tx
              .update(chatMessagePart)
              .set({ payload: { ...row.payload, output: updatedOutput } })
              .where(
                and(
                  eq(chatMessagePart.organizationId, row.organizationId),
                  eq(chatMessagePart.tenantId, row.tenantId),
                  eq(chatMessagePart.threadId, row.threadId),
                  eq(chatMessagePart.id, row.id),
                  sql`${chatMessagePart.payload} = ${JSON.stringify(row.payload)}::jsonb`,
                ),
              )
              .returning({ id: chatMessagePart.id })
            if (!part) return yield* new ChatThreadInvalid()
            for (const continuation of continuations) {
              const metadata = replaceArtifactContinuation(
                continuation.metadata,
                ticket,
                updatedOutput,
              )
              if (metadata === continuation.metadata) continue
              yield* tx
                .update(chatMessage)
                .set({ metadata })
                .where(
                  and(
                    eq(chatMessage.organizationId, row.organizationId),
                    eq(chatMessage.tenantId, row.tenantId),
                    eq(chatMessage.threadId, row.threadId),
                    eq(chatMessage.id, continuation.id),
                  ),
                )
            }
            if (prepared)
              yield* files.claim(tx, scope, {
                version: 1,
                parts: [
                  {
                    id: prepared.id,
                    type: "document",
                    source: { type: "file", provider: APP_HANDLE, value: prepared.id },
                  },
                ],
              })
            return true
          }),
        )
        .pipe(mapDatabaseErrors())
      if (changed) {
        counts.migrated++
        if (!artifact.available) {
          counts.unavailable++
          yield* Effect.logWarning("Historical artifact source is unavailable", {
            ...scope,
            partId: row.id,
            reason: artifact.reason,
          })
        }
      }
    }
    const last = rows.at(-1)!
    cursor = [last.organizationId, last.tenantId, last.threadId, last.id]
  }
  console.log("sandbox_artifacts", counts)
  return counts
})
