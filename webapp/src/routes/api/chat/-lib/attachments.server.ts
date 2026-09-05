import { type ChatMiddleware, EventType } from "@tanstack/ai"

import { profileDelimitedText } from "./attachment-profile.server"
import { extractOfficeDocument, isOfficeMimeType } from "./attachment-office.server"
import {
  CHAT_ATTACHMENT_DELIMITED_MIME_TYPES,
  CHAT_ATTACHMENT_IMAGE_MIME_TYPES,
  CHAT_ATTACHMENT_MAGIC_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES_BY_KIND,
  CHAT_ATTACHMENT_MAX_FILENAME_LENGTH,
  CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_ATTACHMENT_MIME_TYPE_BY_EXTENSION,
  CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES,
  CHAT_ATTACHMENT_PDF_MIME_TYPE,
  CHAT_ATTACHMENT_TEXT_MIME_TYPES,
  CHAT_ATTACHMENT_UPLOAD_DIRECTORY,
} from "./constants.server"
import type {
  ChatAttachmentContent,
  ChatAttachmentFile,
  ChatAttachmentKind,
  ChatAttachmentOutcome,
  ChatMessages,
} from "./types"

/**
 * Rewrites a run's user messages into what the model actually receives.
 *
 * There are exactly two deliveries. An image or a PDF is a modality the provider reads itself, so
 * it passes through as a file input. Everything else becomes a *file*: the user's message keeps
 * only its name, and the agent reaches the contents with `read_attachment` or with code in the
 * sandbox.
 *
 * That split is what makes an upload behave like an upload. Nothing quotes a file into the user's
 * own words, so a file cannot impersonate the user's instructions; nothing is silently truncated,
 * because a paged read has no end to fall off; and a spreadsheet is analyzed as a spreadsheet
 * rather than transcribed into the conversation.
 *
 * Nothing read out of a file is written into a prompt here, either. A filename, a sheet name and a
 * column name are all chosen by whoever made the file, so they travel only as user-message text
 * and as `read_attachment` results — never in a system prompt, whose authority they would borrow.
 *
 * The client re-sends every past attachment on each turn, so each run re-reads them. That is
 * deliberate: it costs a re-read of bytes already in the request and keeps every handle in the
 * conversation resolvable for as long as the client keeps sending it.
 */

// The AG-UI wire carries a user message's attachments in its `content` array, where a text entry
// is `{ type: "text", text }`; a caller that posts UIMessages instead carries them in `parts`,
// where the same entry is `{ type: "text", content }`. Both are normalized, so neither shape can
// slip an unconverted document past this pass.
type ContentShape = "agui" | "ui"

interface MediaEntry {
  type: "image" | "audio" | "video" | "document"
  source: { type?: unknown; value?: unknown; mimeType?: unknown }
  metadata?: unknown
}

const MEDIA_TYPES = new Set(["image", "audio", "video", "document"])

function isMediaEntry(entry: unknown): entry is MediaEntry {
  return typeof entry === "object" && entry !== null &&
    MEDIA_TYPES.has((entry as { type?: unknown }).type as string) &&
    typeof (entry as { source?: unknown }).source === "object" &&
    (entry as { source: unknown }).source !== null
}

function textEntry(shape: ContentShape, text: string) {
  return shape === "agui" ? { type: "text", text } : { type: "text", content: text }
}

/** RFC 2045 parameters off, lower case, so `TEXT/PLAIN; charset=utf-8` compares equal. */
function normalizeMimeType(value: unknown): string {
  return typeof value === "string" ? (value.split(";")[0] ?? "").trim().toLowerCase() : ""
}

function isTextualMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || CHAT_ATTACHMENT_TEXT_MIME_TYPES.includes(mimeType) ||
    mimeType.endsWith("+json") || mimeType.endsWith("+xml")
}

// The filename is client-supplied and lands in the prompt, in the provider request, and in a
// sandbox path, so control characters (which could forge line structure) are replaced and the
// length is bounded.
function sanitizeAttachmentFilename(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
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
  const trusted = isOfficeMimeType(declared) ||
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
  ) return "data"
  if (isTextualMimeType(mimeType)) return "text"
  return undefined
}

/** Strips a data-URI prefix, leaving the base64 payload a `data` source is expected to hold. */
function base64Payload(value: string): string {
  return value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value
}

// Measured from the encoding rather than by decoding, so an oversized payload is refused before
// anything allocates it.
function base64ByteLength(value: string): number {
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
function decodeAttachmentBytes(value: string): Uint8Array | undefined {
  try {
    const binary = atob(base64Payload(value).replace(/\s/g, ""))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return undefined
  }
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
    expected.every((byte, index) => bytes[offset + index] === byte)
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/, "")
  } catch {
    return undefined
  }
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

/**
 * A filesystem-safe name that still reads like the original, made unique across the run so two
 * files called `data.csv` are separately addressable. The handle is what the agent passes to
 * `read_attachment` and the basename of the sandbox path, so it is one name for both.
 */
function attachmentHandle(filename: string, taken: Set<string>): string {
  const cleaned = filename.replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "").slice(0, 80) ||
    "attachment"
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
  options: { readonly sandbox: boolean },
): {
  messages: ChatMessages
  attachments: ChatAttachmentOutcome[]
  files: ChatAttachmentFile[]
} {
  const attachments: ChatAttachmentOutcome[] = []
  const files: ChatAttachmentFile[] = []
  const handles = new Set<string>()
  let totalBytes = 0

  /** One media entry: the provider part it becomes, a refusal, or an attached file. */
  const convert = (
    entry: MediaEntry,
    shape: ContentShape,
  ): { entry: unknown } | { file: ChatAttachmentFile } => {
    const metadata = typeof entry.metadata === "object" && entry.metadata !== null
      ? entry.metadata as { filename?: unknown }
      : {}
    const declared = normalizeMimeType(entry.source.mimeType)
    const filename = sanitizeAttachmentFilename(
      metadata.filename,
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
    const kind = entry.type === "image" || entry.type === "document"
      ? attachmentKind(mimeType)
      : undefined
    const refuse = (reason: string) => {
      attachments.push({ filename, mimeType, bytes: 0, result: "rejected", reason })
      return { entry: textEntry(shape, refusalText(filename, mimeType, reason)) }
    }
    if (typeof entry.source.value !== "string" || entry.source.value.length === 0) {
      return refuse("its contents were missing.")
    }
    // Only inline data: a URL source would have the provider fetch a caller-chosen host on this
    // deployment's API key, and the SDK composer never produces one.
    if (entry.source.type !== "data") {
      return refuse("this assistant accepts only files uploaded with the message.")
    }
    if (!kind) {
      return refuse(
        "this assistant reads images, PDFs, text and source files, CSV and TSV data, Word, " +
          "Excel, and PowerPoint files.",
      )
    }
    const size = base64ByteLength(entry.source.value)
    const limit = CHAT_ATTACHMENT_MAX_BYTES_BY_KIND[kind]
    if (size > limit) {
      return refuse(`it is larger than the ${formatBytes(limit)} limit for that file type.`)
    }
    if (totalBytes + size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      return refuse(
        `the message went over the ${
          formatBytes(CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
        } attachment limit.`,
      )
    }
    if (!hasDeclaredFileSignature(entry.source.value, mimeType)) {
      return refuse(`its contents are not a ${mimeType} file.`)
    }
    if (kind === "image" || kind === "pdf") {
      totalBytes += size
      attachments.push({ filename, mimeType, bytes: size, result: kind })
      // The provider requires a filename beside PDF data, and the sanitized one is the only one
      // trusted to travel; images keep it for symmetry.
      return {
        entry: {
          ...entry,
          type: kind === "image" ? "image" : "document",
          metadata: { ...metadata, filename },
        },
      }
    }
    const bytes = decodeAttachmentBytes(entry.source.value)
    if (bytes === undefined) return refuse("its contents could not be decoded.")
    const content = readAttachmentContent(bytes, mimeType)
    if ("reason" in content) return refuse(content.reason)
    if (content.text === undefined && !options.sandbox) {
      return refuse("this agent has no sandbox to open a file of that type in.")
    }
    totalBytes += size
    const handle = attachmentHandle(filename, handles)
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
   * the files that arrived with it. The user's own text is never touched.
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
    for (const entry of entries) {
      if (!isMediaEntry(entry)) {
        next.push(entry)
        continue
      }
      const result = convert(entry, shape)
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
      const metadata = typeof entry.metadata === "object" && entry.metadata !== null
        ? entry.metadata as { filename?: unknown }
        : {}
      attachments.push({
        filename: sanitizeAttachmentFilename(metadata.filename, "attachment"),
        mimeType: normalizeMimeType(entry.source.mimeType),
        bytes: 0,
        result: "rejected",
        reason: "attachments are read only from a user's own message.",
      })
      return false
    })

  const normalized = messages.map((message) => {
    const next = { ...message } as typeof message & { content?: unknown; parts?: unknown }
    if (message.role === "user") {
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
      isMediaEntry(entry) && typeof entry.source.value === "string"
        ? {
          ...entry,
          source: {
            ...entry.source,
            value: `<${formatBytes(base64ByteLength(entry.source.value))} base64>`,
          },
        }
        : entry
    )
  return messages.map((message) => {
    if (message.role !== "user") return message
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
 * `[Attached: …]` line as text mid-conversation, and the bytes leave the client's copy of the
 * turn: the next request no longer carries the file and its handle stops resolving.
 *
 * A user message that arrived with a media entry is restored exactly as it arrived, so the
 * transcript the client keeps is the one it sent.
 */
export function createChatAttachmentSnapshotMiddleware(messages: ChatMessages): ChatMiddleware {
  const sent = new Map<string, ChatMessages[number]>()
  for (const message of messages) {
    if (message.role !== "user") continue
    const source = message as { id?: unknown; content?: unknown; parts?: unknown }
    if (typeof source.id !== "string" || source.id.length === 0) continue
    const entries = Array.isArray(source.parts) ? source.parts : source.content
    if (Array.isArray(entries) && entries.some(isMediaEntry)) sent.set(source.id, message)
  }
  return {
    name: "astralbeam-chat-attachment-snapshot",
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
