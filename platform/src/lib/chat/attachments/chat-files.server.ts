import { createHash } from "node:crypto"
import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"

import { Database, type EffectDatabase } from "@/db/database.server"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.server"
import { chatFile } from "@/db/schema/chat.server"
import { fileObject } from "@/db/schema/files.server"
import { APP_HANDLE } from "@/lib/constants"
import { StoredFiles, type StoredFile } from "@/lib/storage/stored-files.server"
import { ChatThreadInvalid, ChatThreadStorageUnavailable } from "../threads/errors"
import type { ChatMessagePayload, ChatThreadScope } from "../threads/schemas"
import { decodeAttachmentBytes } from "./attachments.server"
import { CHAT_ATTACHMENT_MAX_COUNT, CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "./constants.server"
import { chatMediaPart, storedChatMediaSource } from "./stored-media"

type ChatFileScope = Pick<ChatThreadScope, "organizationId" | "tenantId"> & { threadId: string }
type ChatFileExecutor = Pick<EffectDatabase, "select" | "insert" | "update">
type ChatFileFailure = ChatThreadInvalid | ChatThreadStorageUnavailable
const chatFileOwnerWhere = (scope: ChatFileScope) =>
  and(
    eq(chatFile.organizationId, scope.organizationId),
    eq(chatFile.tenantId, scope.tenantId),
    eq(chatFile.threadId, scope.threadId),
  )
const chatFileIdentityPrefix = (scope: ChatFileScope) =>
  `chat:${scope.organizationId}:${scope.tenantId}:${scope.threadId}:`

// Only documented media fields are transformed. Provider signatures and opaque context stay intact.
export const mapChatPayloadMedia = Effect.fnUntraced(function* <E, R>(
  payload: ChatMessagePayload,
  transform: (
    part: typeof Schema.JsonObject.Type,
  ) => Effect.Effect<typeof Schema.JsonObject.Type, E, R>,
) {
  const parts = []
  for (const part of payload.parts)
    parts.push({ ...(yield* transform(part)), id: part.id, type: part.type })
  const modelMessages = []
  for (const message of payload.modelMessages ?? []) {
    if (!Array.isArray(message.content)) {
      modelMessages.push(message)
      continue
    }
    const content = []
    for (const part of message.content as (typeof Schema.Json.Type)[]) {
      const decoded = Schema.decodeUnknownOption(Schema.JsonObject)(part)
      content.push(Option.isSome(decoded) ? yield* transform(decoded.value) : part)
    }
    modelMessages.push({ ...message, content })
  }
  return { ...payload, parts, ...(payload.modelMessages ? { modelMessages } : {}) }
})

export class ChatFiles extends Context.Service<
  ChatFiles,
  {
    readonly externalize: (
      scope: ChatFileScope,
      payload: ChatMessagePayload,
    ) => Effect.Effect<ChatMessagePayload, ChatFileFailure>
    readonly hydrate: (
      scope: ChatFileScope,
      payload: ChatMessagePayload,
    ) => Effect.Effect<ChatMessagePayload, ChatFileFailure>
    readonly identity: (
      scope: ChatFileScope,
      parts: readonly (typeof Schema.JsonObject.Type)[],
    ) => Effect.Effect<(typeof Schema.JsonObject.Type)[], ChatFileFailure>
    readonly claim: (
      db: ChatFileExecutor,
      scope: ChatFileScope,
      payload: ChatMessagePayload,
    ) => Effect.Effect<void, ChatThreadInvalid>
    readonly size: (
      scope: ChatFileScope,
      parts: readonly (typeof Schema.JsonObject.Type)[],
    ) => Effect.Effect<number, ChatThreadInvalid>
    readonly read: (
      scope: ChatFileScope,
      id: string,
    ) => Effect.Effect<{ file: StoredFile; bytes: Uint8Array }, ChatFileFailure>
  }
>()("astralbeam/chat/ChatFiles") {
  static readonly layerNoDeps = Layer.effect(
    ChatFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const storage = yield* StoredFiles
      const findOwned = Effect.fnUntraced(function* (scope: ChatFileScope, id: string) {
        const [owned] = yield* db
          .select({ file: fileObject })
          .from(chatFile)
          .innerJoin(fileObject, eq(fileObject.id, chatFile.id))
          .where(
            and(chatFileOwnerWhere(scope), eq(chatFile.id, id), isNotNull(fileObject.verifiedAt)),
          )
          .pipe(mapDatabaseErrors())
        if (!owned) return yield* new ChatThreadInvalid()
        return owned.file
      })
      const read = Effect.fn("ChatFiles.read")(function* (scope: ChatFileScope, id: string) {
        const file = yield* findOwned(scope, id)
        const bytes = yield* storage
          .read(file)
          .pipe(Effect.mapError(() => new ChatThreadStorageUnavailable()))
        return { file, bytes }
      })
      const externalize = Effect.fn("ChatFiles.externalize")(function* (
        scope: ChatFileScope,
        payload: ChatMessagePayload,
      ) {
        const continuation = (payload.modelMessages ?? []).flatMap((message) =>
          Array.isArray(message.content)
            ? (message.content as readonly Schema.Json[]).filter(Schema.is(Schema.JsonObject))
            : [],
        )
        for (const entries of [payload.parts, continuation]) {
          let count = 0
          let total = 0
          for (const part of entries) {
            if (!chatMediaPart(part)) continue
            const source = part.source
            const stored = storedChatMediaSource(part)
            if (Option.isSome(stored)) {
              const [file] = yield* db
                .select({ size: fileObject.byteSize })
                .from(fileObject)
                .where(
                  and(
                    eq(fileObject.id, stored.value.value),
                    isNotNull(fileObject.verifiedAt),
                    sql`${fileObject.sourceIdentity} like ${`${chatFileIdentityPrefix(scope)}%`}`,
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!file) return yield* new ChatThreadInvalid()
              total += file.size
            } else if (Schema.is(Schema.JsonObject)(source) && source.type === "data") {
              const bytes =
                typeof source.value === "string" ? decodeAttachmentBytes(source.value) : null
              if (!bytes) return yield* new ChatThreadInvalid()
              total += bytes.length
            } else continue
            count += 1
            if (count > CHAT_ATTACHMENT_MAX_COUNT || total > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
              return yield* new ChatThreadInvalid()
          }
        }
        return yield* mapChatPayloadMedia(
          payload,
          Effect.fnUntraced(function* (part) {
            if (!chatMediaPart(part)) return part
            const stored = storedChatMediaSource(part)
            if (Option.isSome(stored)) {
              const [file] = yield* db
                .select({ id: fileObject.id })
                .from(fileObject)
                .where(
                  and(
                    eq(fileObject.id, stored.value.value),
                    isNotNull(fileObject.verifiedAt),
                    sql`${fileObject.sourceIdentity} like ${`${chatFileIdentityPrefix(scope)}%`}`,
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!file) return yield* new ChatThreadInvalid()
              return part
            }
            const source = part.source
            if (!Schema.is(Schema.JsonObject)(source) || source.type !== "data") return part
            if (typeof source.value !== "string") return yield* new ChatThreadInvalid()
            const bytes = decodeAttachmentBytes(source.value)
            if (!bytes || bytes.length > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
              return yield* new ChatThreadInvalid()
            const contentType =
              typeof source.mimeType === "string" ? source.mimeType : "application/octet-stream"
            const digest = createHash("sha256").update(bytes).digest("hex")
            const file = yield* storage
              .prepare({
                bytes,
                contentType,
                sourceIdentity: `${chatFileIdentityPrefix(scope)}${digest}:${contentType}`,
              })
              .pipe(Effect.mapError(() => new ChatThreadStorageUnavailable()))
            return {
              ...part,
              source: {
                type: "file",
                provider: APP_HANDLE,
                value: file.id,
                ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
              },
            }
          }),
        )
      })
      const hydrate = Effect.fn("ChatFiles.hydrate")(
        (scope: ChatFileScope, payload: ChatMessagePayload) =>
          mapChatPayloadMedia(
            payload,
            Effect.fnUntraced(function* (part) {
              if (!chatMediaPart(part)) return part
              const stored = storedChatMediaSource(part)
              if (Option.isNone(stored)) return part
              const { bytes } = yield* read(scope, stored.value.value)
              return {
                ...part,
                source: {
                  type: "data",
                  value: Buffer.from(bytes).toString("base64"),
                  ...(stored.value.mimeType === undefined
                    ? {}
                    : { mimeType: stored.value.mimeType }),
                },
              }
            }),
          ),
      )
      const identity = Effect.fn("ChatFiles.identity")(function* (
        scope: ChatFileScope,
        parts: readonly (typeof Schema.JsonObject.Type)[],
      ) {
        const identities = []
        for (const part of parts) {
          if (!chatMediaPart(part)) {
            identities.push(part)
            continue
          }
          const stored = storedChatMediaSource(part)
          let sha256: string, byteSize: number
          if (Option.isSome(stored)) {
            const file = yield* findOwned(scope, stored.value.value)
            sha256 = file.sha256
            byteSize = file.byteSize
          } else {
            const source = part.source
            if (
              !Schema.is(Schema.JsonObject)(source) ||
              source.type !== "data" ||
              typeof source.value !== "string"
            )
              return yield* new ChatThreadInvalid()
            const bytes = decodeAttachmentBytes(source.value)
            if (!bytes || bytes.length > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
              return yield* new ChatThreadInvalid()
            sha256 = createHash("sha256").update(bytes).digest("hex")
            byteSize = bytes.length
          }
          const source = part.source as typeof Schema.JsonObject.Type
          identities.push({
            ...part,
            source: {
              type: "content",
              sha256,
              byteSize,
              ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
            },
          })
        }
        return identities
      })
      const claim = Effect.fn("ChatFiles.claim")(function* (
        executor: ChatFileExecutor,
        scope: ChatFileScope,
        payload: ChatMessagePayload,
      ) {
        const ids = new Set<string>()
        yield* mapChatPayloadMedia(payload, (part) => {
          const source = storedChatMediaSource(part)
          if (chatMediaPart(part) && Option.isSome(source)) ids.add(source.value.value)
          return Effect.succeed(part)
        })
        for (const id of ids) {
          const [file] = yield* executor
            .select()
            .from(fileObject)
            .where(
              and(
                eq(fileObject.id, id),
                isNotNull(fileObject.verifiedAt),
                or(isNull(fileObject.expiresAt), gt(fileObject.expiresAt, sql`now()`)),
              ),
            )
            .for("update")
            .pipe(mapDatabaseErrors())
          if (!file || !file.sourceIdentity?.startsWith(chatFileIdentityPrefix(scope)))
            return yield* new ChatThreadInvalid()
          yield* executor
            .insert(chatFile)
            .values({ ...scope, id })
            .onConflictDoNothing()
            .pipe(mapDatabaseErrors())
          const [owner] = yield* executor
            .select()
            .from(chatFile)
            .where(and(chatFileOwnerWhere(scope), eq(chatFile.id, id)))
            .pipe(mapDatabaseErrors())
          if (!owner) return yield* new ChatThreadInvalid()
          yield* executor
            .update(fileObject)
            .set({ expiresAt: null })
            .where(eq(fileObject.id, id))
            .pipe(mapDatabaseErrors())
        }
      })
      const size = Effect.fn("ChatFiles.size")(function* (
        scope: ChatFileScope,
        parts: readonly (typeof Schema.JsonObject.Type)[],
      ) {
        let total = 0
        for (const part of parts) {
          if (!chatMediaPart(part)) continue
          const source = storedChatMediaSource(part)
          if (Option.isNone(source)) return yield* new ChatThreadInvalid()
          const [file] = yield* db
            .select({ size: fileObject.byteSize })
            .from(fileObject)
            .where(
              and(
                eq(fileObject.id, source.value.value),
                isNotNull(fileObject.verifiedAt),
                sql`${fileObject.sourceIdentity} like ${`${chatFileIdentityPrefix(scope)}%`}`,
              ),
            )
            .pipe(mapDatabaseErrors())
          if (!file) return yield* new ChatThreadInvalid()
          total += file.size
        }
        return total
      })
      return ChatFiles.of({ externalize, hydrate, identity, claim, size, read })
    }),
  )
  static readonly layer = ChatFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, StoredFiles.layer]),
  )
}
