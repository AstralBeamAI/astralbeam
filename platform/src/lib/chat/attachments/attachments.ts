import { type ChatMiddleware, type ModelMessage, EventType } from "@tanstack/ai"
import { Context, Effect, Layer, Predicate, Result, Schema } from "effect"
import { createHash } from "node:crypto"
import { and, eq, isNull, or } from "drizzle-orm"
import { mapDatabaseErrors } from "@/db/lib/sqlstate.ts"
import { Database } from "@/db/database.ts"
import { chatFile } from "@/db/schema/chat.ts"
import { fileObject } from "@/db/schema/files.ts"
import { StoredFiles } from "@/lib/storage/stored-files.server.ts"
import { FilePreviews } from "@/lib/storage/file-previews.server.ts"
import {
  ChatMessagePayloadSchema,
  type ChatMessagePayload,
  type ChatThreadScope,
} from "../threads/schemas.ts"
import { ChatFileUnavailable, ChatThreadInvalid, ChatThreadNotFound } from "../threads/errors.ts"
import type { MessageRecord } from "../threads/threads.ts"

import { APP_HANDLE } from "@/lib/constants"

import { profileDelimitedText } from "./profile"
import { extractOfficeDocument, isOfficeMimeType } from "./office"
import {
  CHAT_ATTACHMENT_DELIMITED_MIME_TYPES,
  CHAT_ATTACHMENT_IMAGE_MIME_TYPES,
  CHAT_ATTACHMENT_MAGIC_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES_BY_KIND,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_FILENAME_LENGTH,
  CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_ATTACHMENT_MIME_TYPE_BY_EXTENSION,
  CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES,
  CHAT_ATTACHMENT_PDF_MIME_TYPE,
  CHAT_ATTACHMENT_TEXT_MIME_TYPES,
  CHAT_ATTACHMENT_UPLOAD_DIRECTORY,
} from "./constants"
import type {
  ChatAttachmentContent,
  ChatAttachmentFile,
  ChatAttachmentKind,
  ChatAttachmentOutcome,
} from "./types"
import type { ChatMessages } from "../types"

/**
 * Rewrites a run's user messages into what the model actually receives.
 *
 * Images and PDFs pass through as provider file inputs. Other uploads become files the agent
 * reads through `read_attachment` or code in its sandbox, rather than quoted user instructions.
 * Paging keeps long files readable, and spreadsheets can be analyzed rather than transcribed.
 *
 * Filenames, sheet names, and column names are caller-controlled. They travel only as user
 * messages and tool results, never in a system prompt whose authority they could borrow.
 */

// The AG-UI wire carries a user message's attachments in its `content` array, where a text entry
// is `{ type: "text", text }`; a caller that posts UIMessages instead carries them in `parts`,
// where the same entry is `{ type: "text", content }`. Both are normalized, so neither shape can
// slip an unconverted document past this pass.
type ContentShape = "agui" | "ui"

interface MediaEntry {
  type: "image" | "audio" | "video" | "document"
  source: { type?: unknown; value?: unknown; mimeType?: unknown; id?: unknown }
  metadata?: unknown
}

const MEDIA_TYPES = new Set(["image", "audio", "video", "document"])

function isMediaEntry(entry: unknown): entry is MediaEntry {
  return (
    Predicate.hasProperty(entry, "type") &&
    Predicate.isString(entry.type) &&
    MEDIA_TYPES.has(entry.type) &&
    Predicate.hasProperty(entry, "source") &&
    Predicate.isObject(entry.source)
  )
}

function mediaEntryFilename(entry: MediaEntry): unknown {
  return Predicate.hasProperty(entry.metadata, "filename") ? entry.metadata.filename : undefined
}

function textEntry(shape: ContentShape, text: string) {
  return shape === "agui" ? { type: "text", text } : { type: "text", content: text }
}

/** RFC 2045 parameters off, lower case, so `TEXT/PLAIN; charset=utf-8` compares equal. */
function normalizeMimeType(value: unknown): string {
  return Predicate.isString(value) ? (value.split(";")[0] ?? "").trim().toLowerCase() : ""
}

function isTextualMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    CHAT_ATTACHMENT_TEXT_MIME_TYPES.includes(mimeType) ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml")
  )
}

// The filename is client-supplied and lands in the prompt, in the provider request, and in a
// sandbox path, so control characters (which could forge line structure) are replaced and the
// length is bounded.
export function sanitizeAttachmentFilename(value: unknown, fallback: string): string {
  if (!Predicate.isString(value)) return fallback
  const cleaned = value.replace(/\p{C}/gu, " ").trim()
  if (cleaned.length === 0) return fallback
  return cleaned.length > CHAT_ATTACHMENT_MAX_FILENAME_LENGTH
    ? `${cleaned.slice(0, CHAT_ATTACHMENT_MAX_FILENAME_LENGTH)}…`
    : cleaned
}

function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ""
}

/**
 * The declared type, repaired from the extension where a browser labels a data or office file
 * badly: Chrome reports no type at all for `.parquet` and `application/octet-stream` for a `.csv`
 * saved by some tools, and the delivery a file gets depends on getting this right.
 */
function resolveMimeType(declared: string, filename: string): string {
  const byExtension = CHAT_ATTACHMENT_MIME_TYPE_BY_EXTENSION[fileExtension(filename)]
  if (byExtension === undefined) return declared
  const trusted =
    isOfficeMimeType(declared) ||
    CHAT_ATTACHMENT_DELIMITED_MIME_TYPES.includes(declared) ||
    CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES.includes(declared)
  return trusted ? declared : byExtension
}

function attachmentKind(mimeType: string): ChatAttachmentKind | undefined {
  if (CHAT_ATTACHMENT_IMAGE_MIME_TYPES.includes(mimeType)) return "image"
  if (mimeType === CHAT_ATTACHMENT_PDF_MIME_TYPE) return "pdf"
  if (isOfficeMimeType(mimeType)) return "office"
  if (
    CHAT_ATTACHMENT_DELIMITED_MIME_TYPES.includes(mimeType) ||
    CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES.includes(mimeType)
  )
    return "data"
  if (isTextualMimeType(mimeType)) return "text"
  return undefined
}

/** Strips a data-URI prefix, leaving the base64 payload a `data` source is expected to hold. */
function base64Payload(value: string): string {
  return value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value
}

// Measured from the encoding rather than by decoding, so an oversized payload is refused before
// anything allocates it.
export function base64ByteLength(value: string): number {
  const payload = base64Payload(value).replace(/\s/g, "")
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

/**
 * Decodes a payload into bytes, filling a preallocated array rather than mapping the string.
 * `Uint8Array.from(binary, callback)` runs a JS callback per byte: 513 ms for a 10 MB attachment
 * against 18 ms for this loop, and it is synchronous, so it blocked the event loop for every
 * concurrent request on the replica. `Uint8Array.fromBase64` would be faster still, but it is a
 * Stage 3 proposal that this TypeScript's lib does not declare.
 */
export function decodeAttachmentBytes(value: string): Uint8Array | undefined {
  const binary = Result.try(() => atob(base64Payload(value).replace(/\s/g, "")))
  if (Result.isFailure(binary)) return undefined
  const bytes = new Uint8Array(binary.success.length)
  for (let index = 0; index < binary.success.length; index += 1) {
    bytes[index] = binary.success.charCodeAt(index)
  }
  return bytes
}

/**
 * Checks the head of a payload against its declared type. Only the first few bytes are decoded, so
 * a renamed 20 MB file costs nothing to refuse. A type with no known signature (and an undecodable
 * head) passes, leaving the decode or the unpack as the judge.
 */
function hasDeclaredFileSignature(value: string, mimeType: string): boolean {
  const signatures = CHAT_ATTACHMENT_MAGIC_BYTES[mimeType]
  if (!signatures) return true
  const payload = base64Payload(value).replace(/\s/g, "")
  // atob needs whole 4-character groups, and 24 of them cover the deepest signature offset.
  const head = payload.slice(0, 24)
  const aligned = head.slice(0, head.length - (head.length % 4))
  const bytes = decodeAttachmentBytes(aligned)
  if (bytes === undefined) return false
  return signatures.every(({ offset, bytes: expected }) =>
    expected.every((byte, index) => bytes[offset + index] === byte),
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** `fatal` turns a binary file mislabeled as text into a refusal instead of a page of U+FFFD. */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  return Result.getOrUndefined(
    Result.try(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  )?.replace(/^\ufeff/, "")
}

/**
 * Reads a file into its text view and its shape. Delimited text is profiled as the table it is;
 * an office file is unpacked; a Parquet file or a database has no text view at all and is left to
 * the sandbox. Returns the reason instead when the bytes are not the format they claim to be.
 *
 * Dispatches on the MIME type rather than the kind, which is derived from it: `office` and the
 * opaque data types each answer the question directly, so passing the kind in as well would be one
 * more argument to keep consistent with the first.
 */
function readAttachmentContent(
  bytes: Uint8Array,
  mimeType: string,
): ChatAttachmentContent | { reason: string } {
  if (isOfficeMimeType(mimeType)) return extractOfficeDocument(bytes, mimeType)
  if (CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES.includes(mimeType)) return {}
  const decoded = decodeUtf8(bytes)
  if (decoded === undefined) return { reason: "it is not valid UTF-8 text." }
  return {
    ...(decoded.length > CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS
      ? { text: decoded.slice(0, CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS), truncated: true }
      : { text: decoded }),
    // The whole text is profiled, not the clamped view, so the row count is the file's own.
    ...(CHAT_ATTACHMENT_DELIMITED_MIME_TYPES.includes(mimeType)
      ? { tables: [profileDelimitedText(decoded)] }
      : {}),
  }
}

function refusalText(filename: string, mimeType: string, reason: string): string {
  return `The user attached the file "${filename}"${
    mimeType ? ` (${mimeType})` : ""
  }, which could not be included: ${reason} Tell the user if it matters to their request.`
}

/** Stored IDs keep handles stable across reloads. Unsaved files use collision-safe names. */
function attachmentHandle(filename: string, taken: Set<string>, fileId?: string): string {
  const cleaned =
    filename
      .replace(/[^\w.-]+/g, "_")
      .replace(/^[._]+/, "")
      .slice(0, 80) || "attachment"
  if (fileId) return `${fileId}-${cleaned}`
  const dot = cleaned.lastIndexOf(".")
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned
  const suffix = dot > 0 ? cleaned.slice(dot) : ""
  let handle = cleaned
  for (let attempt = 2; taken.has(handle); attempt += 1) handle = `${stem}-${attempt}${suffix}`
  taken.add(handle)
  return handle
}

export function normalizeChatAttachments(
  messages: ChatMessages,
  options: {
    readonly sandbox: boolean
    readonly trustedToolMessageIds?: ReadonlySet<string>
  },
): {
  messages: ChatMessages
  attachments: ChatAttachmentOutcome[]
  files: ChatAttachmentFile[]
} {
  const attachments: ChatAttachmentOutcome[] = []
  const files: ChatAttachmentFile[] = []
  const handles = new Set<string>()
  let totalBytes = 0

  /**
   * One media entry: the provider part it becomes, a refusal, or an attached file. `position` is
   * the entry's 1-based place among its own message's media entries, which is what the count cap
   * is about.
   */
  const convert = (
    entry: MediaEntry,
    shape: ContentShape,
    position: number,
  ): { entry: unknown } | { file: ChatAttachmentFile } => {
    const declared = normalizeMimeType(entry.source.mimeType)
    const filename = sanitizeAttachmentFilename(
      mediaEntryFilename(entry),
      declared === CHAT_ATTACHMENT_PDF_MIME_TYPE
        ? "document.pdf"
        : entry.type === "image"
          ? "image"
          : "attachment",
    )
    const mimeType = resolveMimeType(declared, filename)
    // The kind follows the MIME type rather than the part type, so a PNG labeled as a document
    // (or a PDF labeled as an image) is repaired here instead of reaching the provider adapter
    // as a part it refuses. Audio and video have no kind at all.
    const kind =
      entry.type === "image" || entry.type === "document" ? attachmentKind(mimeType) : undefined
    const refuse = (reason: string) => {
      attachments.push({ filename, mimeType, bytes: 0, result: "rejected", reason })
      return { entry: textEntry(shape, refusalText(filename, mimeType, reason)) }
    }
    if (!Predicate.isString(entry.source.value) || entry.source.value.length === 0) {
      return refuse("its contents were missing.")
    }
    // Execution uses transiently hydrated bytes. Never let a provider fetch a caller-chosen URL
    // using this deployment's API key.
    if (entry.source.type !== "data") {
      return refuse("this assistant accepts only files uploaded with the message.")
    }
    if (!kind) {
      return refuse(
        "this assistant reads images, PDFs, text and source files, CSV and TSV data, Word, " +
          "Excel, and PowerPoint files.",
      )
    }
    if (position > CHAT_ATTACHMENT_MAX_COUNT) {
      return refuse(`the message went over the limit of ${CHAT_ATTACHMENT_MAX_COUNT} attachments.`)
    }
    const size = base64ByteLength(entry.source.value)
    const limit = CHAT_ATTACHMENT_MAX_BYTES_BY_KIND[kind]
    if (size > limit) {
      return refuse(`it is larger than the ${formatBytes(limit)} limit for that file type.`)
    }
    if (totalBytes + size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      return refuse(
        `the message went over the ${formatBytes(
          CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
        )} attachment limit.`,
      )
    }
    if (!hasDeclaredFileSignature(entry.source.value, mimeType)) {
      return refuse(`its contents are not a ${mimeType} file.`)
    }
    const bytes = decodeAttachmentBytes(entry.source.value)
    if (bytes === undefined) return refuse("its contents could not be decoded.")
    if (kind === "image" || kind === "pdf") {
      totalBytes += size
      attachments.push({ filename, mimeType, bytes: size, result: kind })
      // The provider requires a filename beside PDF data, and the sanitized one is the only one
      // trusted to travel; images keep it for symmetry.
      return {
        entry: {
          ...entry,
          type: kind === "image" ? "image" : "document",
          metadata: { filename },
        },
      }
    }
    const content = readAttachmentContent(bytes, mimeType)
    if ("reason" in content) return refuse(content.reason)
    if (content.text === undefined && !options.sandbox) {
      return refuse("this agent has no sandbox to open a file of that type in.")
    }
    totalBytes += size
    const fileId = Schema.is(Schema.String.check(Schema.isUUID()))(entry.source.id)
      ? entry.source.id
      : undefined
    const handle = attachmentHandle(filename, handles, fileId)
    const file: ChatAttachmentFile = {
      handle,
      filename,
      mimeType,
      bytes,
      ...content,
      ...(options.sandbox ? { sandboxPath: `${CHAT_ATTACHMENT_UPLOAD_DIRECTORY}/${handle}` } : {}),
    }
    files.push(file)
    attachments.push({ filename, mimeType, bytes: size, result: kind, handle })
    return { file }
  }

  /**
   * Rewrites one user message: media parts become provider parts, refusals, or one line naming
   * the files that arrived with it. The user's own text is kept, without its metadata.
   *
   * That line is all a file leaves in the conversation, and it ties the file to its turn. A
   * transcript that echoes this message therefore reads as the user attaching a file rather than
   * as a wall of quoted bytes.
   */
  const normalizeUserEntries = (entries: unknown[], shape: ContentShape): unknown[] => {
    const next: unknown[] = []
    const attached: string[] = []
    // Where the announcement goes, so it keeps the position of the first file it replaces.
    let slot = -1
    let position = 0
    for (const entry of entries) {
      if (!isMediaEntry(entry)) {
        // Adapters may spread part metadata onto provider blocks, so a caller's never travels.
        if (Predicate.hasProperty(entry, "metadata")) {
          const { metadata: _metadata, ...part } = entry
          next.push(part)
        } else next.push(entry)
        continue
      }
      position += 1
      const result = convert(entry, shape, position)
      if (!("file" in result)) {
        next.push(result.entry)
        continue
      }
      attached.push(result.file.handle)
      if (slot < 0) {
        slot = next.length
        next.push(undefined)
      }
    }
    if (slot >= 0) next[slot] = textEntry(shape, `[Attached: ${attached.join(", ")}]`)
    return next
  }

  // A file is something a user attaches to their own message. Every other role reaches the
  // provider through the same multimodal path — `convertMessagesToModelMessages` dispatches on
  // the presence of `parts` before it looks at the role, and the provider adapter maps anything
  // that is neither `tool` nor `assistant` as a user turn — so a media part smuggled onto a
  // `developer`, `reasoning`, `activity`, or `tool` message would skip every check above it.
  const stripMedia = (entries: unknown[]) =>
    entries.filter((entry) => {
      if (!isMediaEntry(entry)) return true
      attachments.push({
        filename: sanitizeAttachmentFilename(mediaEntryFilename(entry), "attachment"),
        mimeType: normalizeMimeType(entry.source.mimeType),
        bytes: 0,
        result: "rejected",
        reason: "attachments are read only from a user's own message.",
      })
      return false
    })

  const normalized = messages.map((message) => {
    const next = { ...message } as typeof message & { content?: unknown; parts?: unknown }
    if (
      message.role === "user" ||
      (message.role === "tool" &&
        message.id !== undefined &&
        options.trustedToolMessageIds?.has(message.id))
    ) {
      if (Array.isArray(next.content)) next.content = normalizeUserEntries(next.content, "agui")
      if (Array.isArray(next.parts)) next.parts = normalizeUserEntries(next.parts, "ui")
      return next
    }
    if (Array.isArray(next.parts)) {
      const kept = stripMedia(next.parts)
      if (kept.length === next.parts.length) return message
      // An empty `parts` array is worse than none: it collapses the message to null content and
      // the provider rejects the request. Dropping the key restores the role's normal handling.
      if (kept.length === 0) Reflect.deleteProperty(next, "parts")
      else next.parts = kept
      return next
    }
    // Unreachable through the AG-UI validator, which allows array content only on a user
    // message, but stripping costs one branch and does not depend on that staying true.
    if (Array.isArray(next.content)) {
      const kept = stripMedia(next.content)
      if (kept.length === next.content.length) return message
      next.content = kept.length === 0 ? "" : kept
    }
    return next
  })
  return { messages: normalized, attachments, files }
}

/**
 * The same messages with every attachment payload replaced by its size. The debug log prints
 * whole messages, and one inlined image would otherwise fill the terminal with base64.
 */
export function redactChatAttachmentData(messages: ChatMessages): ChatMessages {
  const redactEntries = (entries: unknown[]) =>
    entries.map((entry) =>
      isMediaEntry(entry) && Predicate.isString(entry.source.value)
        ? {
            ...entry,
            source: {
              ...entry.source,
              value: `<${formatBytes(base64ByteLength(entry.source.value))} base64>`,
            },
          }
        : entry,
    )
  return messages.map((message) => {
    const next = { ...message } as typeof message & { content?: unknown; parts?: unknown }
    if (Array.isArray(next.content)) next.content = redactEntries(next.content)
    if (Array.isArray(next.parts)) next.parts = redactEntries(next.parts)
    return next
  })
}

/**
 * Puts a user's own attachments back into the `MESSAGES_SNAPSHOT` the client reads.
 *
 * {@link normalizeChatAttachments} rewrites a user message for the *model*, and the snapshot an
 * interrupt boundary emits is built from those same rewritten messages. The client replaces its
 * transcript with that snapshot, so without this pass a sent file's chip becomes the
 * `[Attached: …]` line as text mid-conversation. Saved history keeps durable file references,
 * while this snapshot preserves the current run's attachment presentation.
 *
 * Persisted messages restore their file references and download IDs. Execution-only bytes
 * stay out of client snapshots.
 */
export function createChatAttachmentSnapshotMiddleware(
  messages: ChatMessages,
  records: readonly Pick<
    MessageRecord,
    "id" | "payload" | "createdAt" | "state" | "authorTenantUserId"
  >[],
): ChatMiddleware {
  const sent = new Map<string, ChatMessages[number]>()
  for (const message of messages) {
    if (message.role !== "user") continue
    const source = message as { id?: unknown; content?: unknown; parts?: unknown }
    if (!Predicate.isString(source.id) || source.id.length === 0) continue
    const entries = Array.isArray(source.parts) ? source.parts : source.content
    if (Array.isArray(entries) && entries.some(isMediaEntry)) {
      const id = source.id
      const record = records.find((record) => record.id === id.split(":")[0])
      if (!record) continue
      const parts = record.payload.parts.map((part) => {
        const file = part.source
        return Schema.is(Schema.JsonObject)(file) && file.type === APP_HANDLE
          ? {
              ...part,
              source: {
                type: "file",
                value: file.id,
                mimeType: file.mimeType,
                byteSize: file.byteSize,
              },
              fileId: file.id,
            }
          : part
      })
      sent.set(id, {
        id,
        role: "user",
        createdAt: record.createdAt,
        metadata: {
          astralbeam: { state: record.state, authorTenantUserId: record.authorTenantUserId },
        },
        parts,
      } as unknown as ChatMessages[number])
    }
  }
  return {
    name: `${APP_HANDLE}-chat-attachment-snapshot`,
    onChunk: (_context, chunk) => {
      if (sent.size === 0 || chunk.type !== EventType.MESSAGES_SNAPSHOT) return
      let restored = false
      const snapshot = chunk.messages.map((message) => {
        const original = message.role === "user" ? sent.get(message.id) : undefined
        if (original === undefined) return message
        restored = true
        // The original is a validated user message off the same request, so it is already the
        // wire shape this event carries.
        return original as typeof message
      })
      // Returning nothing leaves the chunk alone, which is what a run with no restored turn wants.
      return restored ? { ...chunk, messages: snapshot } : undefined
    },
  }
}

type JsonObject = typeof Schema.JsonObject.Type
export interface ChatFileScope {
  organizationId: string
  tenantId: string
  threadId: string
  tenantUserId?: string
}
export type ChatFileCache = Map<string, typeof storedSource.Type & { byteSize: number }>
type FileError = ChatThreadInvalid | ChatFileUnavailable | ChatThreadNotFound

const storedSource = Schema.Struct({
  type: Schema.Literal(APP_HANDLE),
  id: Schema.String.check(Schema.isUUID()),
  mimeType: Schema.String,
})
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const ownedFiles = (scope: ChatFileScope) =>
  and(
    eq(chatFile.organizationId, scope.organizationId),
    eq(chatFile.tenantId, scope.tenantId),
    eq(chatFile.threadId, scope.threadId),
  )

// Visit media in canonical parts and native provider content. Tool outputs and arguments stay opaque.
function mapChatMedia<E, R>(
  value: unknown,
  change: (part: JsonObject) => Effect.Effect<JsonObject, E, R>,
): Effect.Effect<unknown, E, R> {
  return Effect.gen(function* () {
    if (Array.isArray(value))
      return yield* Effect.forEach(value, (item) => mapChatMedia(item, change))
    if (!Schema.is(Schema.JsonObject)(value)) return value
    if (
      typeof value.type === "string" &&
      ["image", "document", "audio", "video"].includes(value.type) &&
      Schema.is(Schema.JsonObject)(value.source)
    )
      return yield* change(value)
    if (value.type === "tool-call" || value.type === "tool-result") return value
    let result: Record<string, unknown> = value
    for (const key of ["parts", "modelMessages", "content"]) {
      if (Array.isArray(value[key]))
        result = { ...result, [key]: yield* mapChatMedia(value[key], change) }
    }
    return result
  })
}

function chatFileMimeType(part: JsonObject) {
  const source = part.source as JsonObject
  const metadata = Schema.is(Schema.JsonObject)(part.metadata) ? part.metadata : {}
  return resolveMimeType(
    normalizeMimeType(source.mimeType) || "application/octet-stream",
    typeof metadata.filename === "string" ? metadata.filename : "",
  )
}

function inlineFile(part: JsonObject, limit: number) {
  const source = Schema.decodeUnknownSync(Schema.JsonObject)(part.source)
  const value = Schema.decodeUnknownSync(Schema.String)(source.value)
  const mimeType = chatFileMimeType(part)
  if (mimeType.length > 255 || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw new ChatThreadInvalid()
  if (
    value.length > CHAT_ATTACHMENT_MAX_TOTAL_BYTES * 2 ||
    base64ByteLength(value) > limit ||
    !hasDeclaredFileSignature(value, mimeType)
  )
    throw new ChatThreadInvalid()
  const bytes = decodeAttachmentBytes(value)
  if (!bytes || bytes.length > limit) throw new ChatThreadInvalid()
  return { bytes, mimeType, digest: sha256(bytes) }
}

export const identifyChatFiles = (parts: readonly JsonObject[]) =>
  Effect.forEach(parts, (part) =>
    Effect.try({
      try: () => {
        if (!Schema.is(Schema.JsonObject)(part.source) || part.source.type !== "data") return part
        const file = inlineFile(part, CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
        return {
          ...part,
          source: {
            type: "content",
            sha256: file.digest,
            byteSize: file.bytes.length,
            mimeType: file.mimeType,
          },
        }
      },
      catch: () => new ChatThreadInvalid(),
    }),
  )

export class ChatFiles extends Context.Service<
  ChatFiles,
  {
    readonly store: (input: {
      scope: ChatThreadScope & { threadId?: string }
      payload: ChatMessagePayload
      cache?: ChatFileCache
    }) => Effect.Effect<ChatMessagePayload, FileError>
    readonly read: (input: {
      scope: Omit<ChatFileScope, "threadId"> & { threadId?: string }
      fileId: string
      preview?: boolean
    }) => Effect.Effect<{ bytes: Uint8Array; mimeType: string }, FileError>
    readonly hydrate: (input: {
      scope: ChatFileScope
      messages: readonly ModelMessage[]
    }) => Effect.Effect<ModelMessage[], FileError>
    readonly attach: (input: {
      scope: ChatFileScope & { tenantUserId: string }
      messageId: string
      value: unknown
    }) => Effect.Effect<number, ChatThreadInvalid>
  }
>()("astralbeam/chat/ChatFiles") {
  // Stores verified bytes outside transactions. Callers authorize writes and commit references afterward.
  static readonly layerNoDeps = Layer.effect(
    ChatFiles,
    Effect.gen(function* () {
      const db = yield* Database
      const files = yield* StoredFiles
      const previews = yield* FilePreviews
      const queryFile = (id: string, ownership: ReturnType<typeof ownedFiles>) =>
        db
          .select({ file: fileObject, attachment: chatFile })
          .from(chatFile)
          .innerJoin(
            fileObject,
            and(
              eq(fileObject.organizationId, chatFile.organizationId),
              eq(fileObject.id, chatFile.fileObjectId),
            ),
          )
          .where(and(ownership, eq(fileObject.id, id), eq(fileObject.status, "stored")))
      const available = (scope: ChatThreadScope & { threadId?: string }) =>
        and(
          eq(chatFile.organizationId, scope.organizationId),
          eq(chatFile.tenantId, scope.tenantId),
          or(
            and(isNull(chatFile.messageId), eq(chatFile.uploaderTenantUserId, scope.tenantUserId)),
            scope.threadId ? eq(chatFile.threadId, scope.threadId) : undefined,
          ),
        )
      const upload = Effect.fnUntraced(function* (
        scope: ChatThreadScope,
        part: JsonObject,
        input: ReturnType<typeof inlineFile>,
        cache: ChatFileCache,
      ) {
        const key = `${input.mimeType}:${input.digest}`
        let reference = cache.get(key)
        if (!reference) {
          const saved = yield* files
            .upload({
              organizationId: scope.organizationId,
              bytes: input.bytes,
              contentType: input.mimeType,
            })
            .pipe(Effect.mapError(() => new ChatFileUnavailable()))
          yield* db
            .insert(chatFile)
            .values({
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              uploaderTenantUserId: scope.tenantUserId,
              fileObjectId: saved.id,
            })
            .pipe(mapDatabaseErrors())
          reference = {
            type: APP_HANDLE,
            id: saved.id,
            mimeType: input.mimeType,
            byteSize: input.bytes.length,
          }
          cache.set(key, reference)
        }
        return { ...part, source: reference }
      })
      const store: typeof ChatFiles.Service.store = ({ scope, payload, cache = new Map() }) => {
        const sizes = new Map<string, number>()
        return mapChatMedia(payload, (inputPart) =>
          Effect.gen(function* () {
            const rawMetadata = inputPart.metadata
            const metadata: Record<string, typeof Schema.Json.Type> = Schema.is(Schema.JsonObject)(
              rawMetadata,
            )
              ? rawMetadata
              : {}
            const part: JsonObject = {
              ...inputPart,
              metadata: {
                ...metadata,
                filename: sanitizeAttachmentFilename(
                  metadata.filename,
                  inputPart.type === "image" ? "image" : "attachment",
                ),
              },
            }
            const source = part.source as JsonObject
            if (
              source.type === "file" &&
              Schema.is(Schema.String.check(Schema.isUUID()))(source.value)
            ) {
              const id = source.value
              const [saved] = yield* queryFile(id, available(scope)).pipe(mapDatabaseErrors())
              if (!saved) return yield* new ChatThreadInvalid()
              return {
                ...part,
                source: {
                  type: APP_HANDLE,
                  id,
                  mimeType: saved.file.contentType,
                  byteSize: saved.file.byteSize,
                },
              }
            }
            if (source.type !== "data") return part
            const kind = attachmentKind(chatFileMimeType(part))
            if (!kind && (part.type === "image" || part.type === "document"))
              return yield* new ChatThreadInvalid()
            const input = yield* Effect.try({
              try: () =>
                inlineFile(
                  part,
                  kind ? CHAT_ATTACHMENT_MAX_BYTES_BY_KIND[kind] : CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
                ),
              catch: () => new ChatThreadInvalid(),
            })
            sizes.set(`${input.mimeType}:${input.digest}`, input.bytes.length)
            if (
              sizes.size > CHAT_ATTACHMENT_MAX_COUNT ||
              [...sizes.values()].reduce((a, b) => a + b, 0) > CHAT_ATTACHMENT_MAX_TOTAL_BYTES
            )
              return yield* new ChatThreadInvalid()
            return yield* upload(scope, part, input, cache)
          }),
        ).pipe(
          Effect.flatMap((stored) =>
            Schema.decodeUnknownEffect(ChatMessagePayloadSchema)(stored).pipe(
              Effect.mapError(() => new ChatThreadInvalid()),
            ),
          ),
        )
      }
      const read = Effect.fnUntraced(function* ({
        scope,
        fileId,
        preview = false,
        maxBytes = CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
      }: Parameters<typeof ChatFiles.Service.read>[0] & { maxBytes?: number }) {
        if (!preview && !scope.threadId) return yield* new ChatThreadInvalid()
        // Admission reads uploader-private files. Saved downloads use conversation ownership.
        const ownership = scope.tenantUserId
          ? available({ ...scope, tenantUserId: scope.tenantUserId })
          : scope.threadId
            ? ownedFiles({ ...scope, threadId: scope.threadId })
            : undefined
        if (!ownership) return yield* new ChatThreadInvalid()
        const [saved] = yield* queryFile(fileId, ownership)
        if (!saved) return yield* new ChatThreadInvalid()
        const file = saved.file
        if (preview)
          return yield* previews.read({ file }).pipe(
            Effect.map((result) => result ?? { bytes: new Uint8Array(), mimeType: "image/webp" }),
            Effect.mapError(() => new ChatFileUnavailable()),
          )
        if (file.byteSize > maxBytes) return yield* new ChatThreadInvalid()
        const bytes = yield* files
          .read({ file })
          .pipe(Effect.mapError(() => new ChatFileUnavailable()))
        return { bytes, mimeType: file.contentType }
      })
      const hydrate = ({ scope, messages }: Parameters<typeof ChatFiles.Service.hydrate>[0]) => {
        let totalBytes = 0
        return Effect.forEach(messages, (message) =>
          Array.isArray(message.content)
            ? Effect.forEach(message.content, (part) =>
                Effect.gen(function* () {
                  if (part.type === "text") return part
                  const source: unknown = part.source
                  if (!Schema.is(Schema.JsonObject)(source)) return part
                  const id =
                    source.type === APP_HANDLE
                      ? source.id
                      : source.type === "file"
                        ? source.value
                        : undefined
                  if (!Schema.is(Schema.String.check(Schema.isUUID()))(id)) return part
                  const file = yield* read({
                    scope,
                    fileId: id,
                    maxBytes: CHAT_ATTACHMENT_MAX_TOTAL_BYTES - totalBytes,
                  })
                  totalBytes += file.bytes.length
                  return {
                    ...part,
                    source: {
                      type: "data" as const,
                      id,
                      value: Buffer.from(file.bytes).toString("base64"),
                      mimeType: file.mimeType,
                      byteSize: file.bytes.length,
                    },
                  }
                }),
              ).pipe(Effect.map((content) => ({ ...message, content })))
            : Effect.succeed(message),
        )
      }
      const attach = Effect.fnUntraced(function* ({
        scope,
        messageId,
        value,
      }: {
        scope: ChatFileScope & { tenantUserId: string }
        messageId: string
        value: unknown
      }) {
        let size = 0
        let count = 0
        yield* mapChatMedia(value, (part) =>
          Effect.gen(function* () {
            if (!Schema.is(storedSource)(part.source)) {
              if (Schema.is(Schema.JsonObject)(part.source) && part.source.type === "data")
                return yield* new ChatThreadInvalid()
              return part
            }
            const rows = yield* queryFile(part.source.id, available(scope)).for("update")
            const saved = rows[0]
            if (!saved) return yield* new ChatThreadInvalid()
            const file = saved.file
            if (!rows.some(({ attachment }) => attachment.messageId === messageId)) {
              const pending = rows.find(({ attachment }) => attachment.messageId === null)
              if (pending)
                yield* db
                  .update(chatFile)
                  .set({ threadId: scope.threadId, messageId })
                  .where(
                    and(
                      eq(chatFile.organizationId, scope.organizationId),
                      eq(chatFile.tenantId, scope.tenantId),
                      eq(chatFile.id, pending.attachment.id),
                    ),
                  )
              else
                yield* db.insert(chatFile).values({
                  organizationId: scope.organizationId,
                  tenantId: scope.tenantId,
                  uploaderTenantUserId: scope.tenantUserId,
                  fileObjectId: file.id,
                  threadId: scope.threadId,
                  messageId,
                })
            }
            size += file.byteSize
            count++
            if (count > CHAT_ATTACHMENT_MAX_COUNT || size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
              return yield* new ChatThreadInvalid()
            return part
          }),
        )
        return size
      })
      return ChatFiles.of({
        store: (input) => store(input).pipe(mapDatabaseErrors()),
        read: (input) => read(input).pipe(mapDatabaseErrors()),
        hydrate: (input) => hydrate(input).pipe(mapDatabaseErrors()),
        attach: (input) => attach(input).pipe(mapDatabaseErrors()),
      })
    }),
  )
  static readonly layer = ChatFiles.layerNoDeps.pipe(
    Layer.provide([Database.layer, StoredFiles.layer, FilePreviews.layer]),
  )
}
