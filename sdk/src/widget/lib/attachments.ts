// Chat-chunk-only: turns the files a user picks into the message parts the chat endpoint reads.
// Pure except for readAttachmentData, so the limits and the classification are testable.

import type { ContentPart } from "@tanstack/ai/client"
import type { AstralBeamChatAttachmentOptions } from "../../lib/types.ts"
import {
  ATTACHMENT_DATA_MIME_TYPES,
  ATTACHMENT_IMAGE_MIME_TYPES,
  ATTACHMENT_MIME_TYPE_BY_EXTENSION,
  ATTACHMENT_OFFICE_MIME_TYPES,
  ATTACHMENT_PDF_MIME_TYPE,
  ATTACHMENT_TEXT_EXTENSIONS,
  ATTACHMENT_TEXT_FILENAMES,
  ATTACHMENT_TEXT_MIME_TYPES,
  MAX_ATTACHMENT_BYTES_BY_KIND,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "./constants.ts"
import type { AttachmentKind, DraftAttachment, ResolvedAttachmentOptions } from "./types.ts"

/** The fields of a `File` the limits and classification need, so tests can pass plain objects. */
export interface AttachmentFileInfo {
  name: string
  /** The browser's guess at the MIME type; empty for extensions it does not know. */
  type: string
  size: number
}

export function resolveAttachmentOptions(
  option: boolean | AstralBeamChatAttachmentOptions | undefined,
): ResolvedAttachmentOptions {
  const given: AstralBeamChatAttachmentOptions = typeof option === "object" && option !== null
    ? option
    : {}
  // A positive number is required for every cap: a zero or negative override would silently
  // reject every file, which reads as a broken composer rather than as a configured limit.
  const positive = (value: number | undefined, fallback: number) =>
    typeof value === "number" && value > 0 ? value : fallback
  return {
    enabled: option === false ? false : given.enabled !== false,
    maxFiles: positive(given.maxFiles, MAX_ATTACHMENTS_PER_MESSAGE),
    maxFileBytes: positive(given.maxFileBytes, Number.POSITIVE_INFINITY),
    maxTotalBytes: positive(given.maxTotalBytes, MAX_ATTACHMENT_TOTAL_BYTES),
    accept: given.accept ?? [],
  }
}

/** Normalizes a MIME type for comparison: RFC 2045 parameters off, lower case. */
function normalizeMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase()
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

function isTextualMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || ATTACHMENT_TEXT_MIME_TYPES.includes(mimeType) ||
    mimeType.endsWith("+json") || mimeType.endsWith("+xml")
}

/** Matches one `accept` entry, which is either a full MIME type or a `type/*` pattern. */
function matchesAcceptEntry(mimeType: string, entry: string): boolean {
  const pattern = normalizeMimeType(entry)
  if (pattern.endsWith("/*")) return mimeType.startsWith(pattern.slice(0, -1))
  return pattern === mimeType
}

/** The kind a MIME type belongs to, for a file whose name says nothing useful. */
function mimeTypeKind(mimeType: string): AttachmentKind | undefined {
  if (ATTACHMENT_IMAGE_MIME_TYPES.includes(mimeType)) return "image"
  if (mimeType === ATTACHMENT_PDF_MIME_TYPE) return "pdf"
  if (ATTACHMENT_OFFICE_MIME_TYPES.includes(mimeType)) return "office"
  if (ATTACHMENT_DATA_MIME_TYPES.includes(mimeType)) return "data"
  if (isTextualMimeType(mimeType)) return "text"
  return undefined
}

/**
 * Decides what a file is and what type to send it as, correcting the browser's MIME guess where it
 * is unusable. Returns the kind and the type, or the reason the file cannot be sent.
 */
export function classifyAttachmentFile(
  file: AttachmentFileInfo,
  limits: ResolvedAttachmentOptions,
): { kind: AttachmentKind; mimeType: string } | { error: string } {
  const reported = normalizeMimeType(file.type)
  const extension = fileExtension(file.name)
  const name = file.name.toLowerCase()
  const canonical = ATTACHMENT_MIME_TYPE_BY_EXTENSION[extension]
  let kind: AttachmentKind | undefined
  let mimeType = reported
  if (canonical !== undefined) {
    // These formats are identified by extension: browsers report nothing for `.parquet` and
    // `application/octet-stream` for the `.csv` some tools write.
    kind = ATTACHMENT_OFFICE_MIME_TYPES.includes(canonical) ? "office" : "data"
    mimeType = canonical
    // `.env.production` and friends are the one family worth a prefix; the rest are exact names.
  } else if (
    ATTACHMENT_TEXT_FILENAMES.includes(name) || name === ".env" || name.startsWith(".env.") ||
    ATTACHMENT_TEXT_EXTENSIONS.includes(extension)
  ) {
    kind = "text"
    // Sent as the browser's type only when that type is itself textual; `.ts` arrives as
    // `video/mp2t`, which the endpoint would refuse to read.
    mimeType = isTextualMimeType(reported) ? reported : "text/plain"
  } else {
    kind = mimeTypeKind(reported)
  }
  if (!kind) return { error: "Unsupported file type" }
  if (
    limits.accept.length > 0 && !limits.accept.some((entry) => matchesAcceptEntry(mimeType, entry))
  ) {
    return { error: "This chat does not accept that file type" }
  }
  return { kind, mimeType }
}

/** Per-file cap: the kind's own limit, lowered by a host-supplied ceiling. */
function attachmentSizeLimit(
  kind: AttachmentKind,
  limits: ResolvedAttachmentOptions,
): number {
  return Math.min(MAX_ATTACHMENT_BYTES_BY_KIND[kind], limits.maxFileBytes)
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Bytes already committed to the next message; unread files count at their reported size. */
function attachmentBytesUsed(attachments: readonly DraftAttachment[]): number {
  return attachments.reduce(
    (total, attachment) => attachment.status === "error" ? total : total + attachment.size,
    0,
  )
}

/** The `accept` attribute for the file input, so the picker filters before a file is chosen. */
export function attachmentAcceptAttribute(limits: ResolvedAttachmentOptions): string {
  if (limits.accept.length > 0) return limits.accept.join(",")
  return [
    ...ATTACHMENT_IMAGE_MIME_TYPES,
    ATTACHMENT_PDF_MIME_TYPE,
    "text/*",
    ...ATTACHMENT_TEXT_MIME_TYPES,
    ...ATTACHMENT_DATA_MIME_TYPES,
    ...ATTACHMENT_OFFICE_MIME_TYPES,
    // Extensions as well as types: the picker matches either, and a browser that reports no
    // type for `.tsx` or `.parquet` would otherwise grey the file out.
    ...ATTACHMENT_TEXT_EXTENSIONS.map((extension) => `.${extension}`),
    ...Object.keys(ATTACHMENT_MIME_TYPE_BY_EXTENSION).map((extension) => `.${extension}`),
  ].join(",")
}

/**
 * Applies the limits to newly picked files. Every file comes back as a draft, rejected ones
 * with `status: "error"` and the reason, so the composer can show why rather than dropping
 * the file; the caller reads only the ones that come back as `"reading"`.
 */
export function acceptAttachmentFiles<TFile extends AttachmentFileInfo>(
  { files, existing, limits, createId }: {
    files: readonly TFile[]
    existing: readonly DraftAttachment[]
    limits: ResolvedAttachmentOptions
    createId: () => string
  },
): Array<{ draft: DraftAttachment; file: TFile }> {
  let slots = limits.maxFiles -
    existing.filter((attachment) => attachment.status !== "error").length
  let bytes = attachmentBytesUsed(existing)
  return files.map((file) => {
    const base = { id: createId(), name: file.name, size: file.size, mimeType: file.type }
    const rejected = (error: string) => ({
      draft: { ...base, status: "error" as const, error },
      file,
    })
    const classified = classifyAttachmentFile(file, limits)
    if ("error" in classified) return rejected(classified.error)
    if (file.size === 0) return rejected("The file is empty")
    if (slots <= 0) return rejected(`Up to ${limits.maxFiles} files per message`)
    const sizeLimit = attachmentSizeLimit(classified.kind, limits)
    if (file.size > sizeLimit) return rejected(`Too large (max ${formatAttachmentSize(sizeLimit)})`)
    if (bytes + file.size > limits.maxTotalBytes) {
      return rejected(`Over the ${formatAttachmentSize(limits.maxTotalBytes)} message limit`)
    }
    slots -= 1
    bytes += file.size
    return {
      draft: { ...base, mimeType: classified.mimeType, kind: classified.kind, status: "reading" },
      file,
    }
  })
}

/**
 * Reads a file as base64 without the data-URI prefix, which is what a `data` content source
 * carries; the MIME type travels beside it on the source, not inside the payload.
 */
export function readAttachmentData(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."))
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const comma = result.indexOf(",")
      if (comma < 0) reject(new Error("The file could not be read."))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Renders an attachment back as a data URI, for an image thumbnail in the composer or transcript. */
export function attachmentDataUri(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`
}

/**
 * The content part one attachment becomes. Images are the model's own modality; everything
 * else is a document, and `filename` is what the endpoint labels a text file with and what
 * the provider requires alongside PDF data.
 */
function attachmentContentPart(attachment: DraftAttachment): ContentPart | undefined {
  if (attachment.status !== "ready" || attachment.data === undefined) return undefined
  const source = {
    type: "data" as const,
    value: attachment.data,
    mimeType: attachment.mimeType,
  }
  const metadata = { filename: attachment.name, size: attachment.size }
  return attachment.kind === "image"
    ? { type: "image", source, metadata }
    : { type: "document", source, metadata }
}

/**
 * Describes a media part already in the transcript. Everything is read defensively: the parts
 * of a restored or host-built conversation carry no guaranteed metadata, and the sending
 * composer is the only thing that puts a filename on them.
 */
export function describeSentAttachment(
  part: {
    type: "image" | "document"
    source: { type: string; value: string; mimeType?: string }
    metadata?: unknown
  },
): {
  kind: AttachmentKind
  title: string
  description: string | undefined
  /** Where the file itself lives, for the thumbnail and the download; absent if it carries none. */
  href: string | undefined
} {
  const metadata = typeof part.metadata === "object" && part.metadata !== null
    ? part.metadata as { filename?: unknown; size?: unknown }
    : {}
  const url = part.source.type === "url" ? part.source.value : undefined
  const title = typeof metadata.filename === "string" && metadata.filename.length > 0
    ? metadata.filename
    // Media parts carry no filename of their own, so fall back to the URL's last segment.
    : url?.split(/[/\\?#]/).filter(Boolean).at(-1) ??
      (part.type === "image" ? "Image" : "Attachment")
  const size = typeof metadata.size === "number" && metadata.size > 0
    ? formatAttachmentSize(metadata.size)
    : undefined
  // A restored or host-built part may carry no type at all, so an unrecognized one reads as text.
  const kind: AttachmentKind = part.type === "image"
    ? "image"
    : mimeTypeKind(normalizeMimeType(part.source.mimeType ?? "")) ?? "text"
  // The part already carries the bytes, so one reference serves both the thumbnail and the
  // download; a `data` source becomes the data URI a download anchor can point at.
  const href = url ??
    (part.source.value.length === 0
      ? undefined
      : part.source.value.startsWith("data:")
      ? part.source.value
      : attachmentDataUri(
        part.source.mimeType ?? (kind === "image" ? "image/png" : "application/octet-stream"),
        part.source.value,
      ))
  return { kind, title, description: size, href }
}

/** The parts to send with a message, in pick order; unread and rejected files are left out. */
export function attachmentContentParts(attachments: readonly DraftAttachment[]): ContentPart[] {
  return attachments.map(attachmentContentPart).filter((part): part is ContentPart =>
    part !== undefined
  )
}
