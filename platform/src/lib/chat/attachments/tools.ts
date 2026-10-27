import { type AnyServerTool, toolDefinition } from "@tanstack/ai"
import * as Schema from "effect/Schema"
import { NonEmptyStringSchema } from "@/lib/schemas.ts"

import { CHAT_ATTACHMENT_IMAGE_MIME_TYPES, CHAT_ATTACHMENT_READ_MAX_CHARACTERS } from "./constants"
import type { ChatAttachmentFile } from "./types"
import { chatToolInputSchema } from "../tool-schema"
import { normalizeChatAttachments } from "./attachments"
import {
  chatAttachmentMediaSupported,
  type ChatAttachmentMedia,
  type ChatAttachmentReference,
} from "./retrieval"

// Saved files are readable by stable ID through bounded text pages or scoped media references.
// File-derived content stays in tool output, never in a higher-authority prompt.

const ReadAttachmentInputSchema = chatToolInputSchema(
  Schema.Struct({
    file: Schema.optionalKey(
      NonEmptyStringSchema.annotate({
        description: "Name of the attached file, exactly as the user's message gives it.",
      }),
    ),
    fileId: Schema.optionalKey(
      Schema.String.check(Schema.isUUID()).annotate({
        description: "Stable fileId from list_attachments. Supply either fileId or file.",
      }),
    ),
    offset: Schema.optionalKey(
      Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description: "Character to start at. Defaults to the beginning of the file.",
      }),
    ),
    limit: Schema.optionalKey(
      Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))).annotate({
        description: `Characters to read, up to ${CHAT_ATTACHMENT_READ_MAX_CHARACTERS}, which is the default.`,
      }),
    ),
  }),
)

/** Declares attachment tools only when the selected ancestry has files to read. */
export function createChatAttachmentTools(
  files: readonly ChatAttachmentFile[],
  recovery?: {
    readonly catalogue: readonly ChatAttachmentReference[]
    readonly read: (fileId: string) => Promise<{ bytes: Uint8Array; mimeType: string }>
    readonly prepare?: (file: ChatAttachmentFile) => Promise<void>
    readonly media: ChatAttachmentMedia
    readonly remainingBytes: number
  },
): AnyServerTool[] {
  if (files.length === 0 && !recovery?.catalogue.length) return []
  let remainingBytes = recovery?.remainingBytes ?? 0

  const readAttachment = toolDefinition({
    name: "read_attachment",
    metadata: { source: "chat-attachment" },
    description:
      "Read a file the user attached, by fileId from list_attachments or by the name shown in their message. Answers " +
      "with the file's type and size, its columns and row count when it is a table, and where " +
      "it lives in your sandbox. Long files come back a page at a time: read on from " +
      "`nextOffset` until `end` is true. Images and PDFs return the original media when this model supports it, without text paging.",
    inputSchema: ReadAttachmentInputSchema,
  }).server(async ({ file: handle, fileId, offset = 0, limit }) => {
    if (fileId !== undefined) {
      if (handle !== undefined) return { refusal: "Supply either fileId or file, not both." }
      const reference = recovery?.catalogue.find((entry) => entry.fileId === fileId)
      if (!reference || !recovery)
        return { refusal: "That file is not available in this conversation path." }
      const media =
        CHAT_ATTACHMENT_IMAGE_MIME_TYPES.includes(reference.mimeType) ||
        reference.mimeType === "application/pdf"
      if (media && !chatAttachmentMediaSupported(reference, recovery.media))
        return { refusal: "This model connection cannot read this file as media." }
      if (media && (offset !== 0 || limit !== undefined))
        return { refusal: "Images and PDFs are read as whole files. Omit offset and limit." }
      const saved = await recovery.read(fileId)
      const source = {
        type: "data" as const,
        id: fileId,
        value: Buffer.from(saved.bytes).toString("base64"),
        mimeType: saved.mimeType,
      }
      const normalized = normalizeChatAttachments(
        [
          {
            role: "user",
            content: [
              {
                type: reference.type,
                source,
                metadata: { filename: reference.filename },
              },
            ],
          },
        ],
        { sandbox: recovery.prepare !== undefined },
      )
      if (normalized.attachments.some((entry) => entry.result === "rejected"))
        return { refusal: "This attachment cannot be read within the file limits." }
      if (media) {
        // Reserve synchronously after the read so concurrent calls share the same budget.
        if (saved.bytes.length > remainingBytes)
          return { refusal: "This attachment would exceed the conversation's media limit." }
        remainingBytes -= saved.bytes.length
        return {
          type: "attachment-reference",
          version: 1,
          fileId,
          sourceMessageId: reference.sourceMessageId,
          filename: reference.filename,
          mimeType: saved.mimeType,
          bytes: saved.bytes.length,
        }
      }
      const file = normalized.files[0]
      if (!file) return { refusal: "This file has no readable text." }
      if (recovery.prepare) await recovery.prepare(file)
      return { ...readChatAttachmentPage(file, offset, limit), fileId }
    }
    if (handle === undefined)
      return { refusal: "Supply fileId or file to identify the attachment." }
    const file = files.find((candidate) => candidate.handle === handle)
    if (!file) {
      return {
        refusal: `There is no attached file with the handle "${handle}". The attached files are: ${files
          .slice(0, 20)
          .map((candidate) => `"${candidate.handle}"`)
          .join(", ")}.${recovery ? " Use list_attachments to find saved files by fileId." : ""}`,
      }
    }
    return readChatAttachmentPage(file, offset, limit)
  })
  if (!recovery) return [readAttachment]
  const listAttachments = toolDefinition({
    name: "list_attachments",
    metadata: { source: "chat-attachment" },
    description:
      "List original user attachments available on this conversation path. Use fileId with read_attachment. Results are paged and contain no file contents.",
    inputSchema: chatToolInputSchema(
      Schema.Struct({
        offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
        limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
      }),
    ),
  }).server(({ offset = 0, limit = 20 }) => {
    const start = Math.min(offset, recovery.catalogue.length)
    const entries = recovery.catalogue.slice(start, start + Math.min(limit, 50))
    const next = start + entries.length
    return {
      attachments: entries,
      end: next >= recovery.catalogue.length,
      ...(next < recovery.catalogue.length ? { nextOffset: next } : {}),
    }
  })
  return [readAttachment, listAttachments]
}

function readChatAttachmentPage(file: ChatAttachmentFile, offset: number, limit?: number) {
  const handle = file.handle
  if (file.text === undefined) {
    return {
      refusal:
        file.sandboxPath === undefined
          ? `"${handle}" is a ${file.mimeType} file with no text to read, and this agent has no ` +
            "sandbox to open it in. Tell the user you cannot read that file."
          : `"${handle}" is a ${file.mimeType} file with no text to read. Open it with code in ` +
            `the sandbox at ${file.sandboxPath} instead.`,
    }
  }
  // A page is bounded whatever the agent asks for: the limit is model context, not a preference.
  const start = Math.min(offset, file.text.length)
  const size = Math.min(
    limit === undefined ? CHAT_ATTACHMENT_READ_MAX_CHARACTERS : limit,
    CHAT_ATTACHMENT_READ_MAX_CHARACTERS,
  )
  const content = file.text.slice(start, start + size)
  const stop = start + content.length
  const done = stop >= file.text.length
  return {
    file: handle,
    filename: file.filename,
    mimeType: file.mimeType,
    bytes: file.bytes.length,
    content,
    offset: start,
    totalCharacters: file.text.length,
    end: done,
    ...(done ? {} : { nextOffset: stop }),
    ...(file.truncated ? { readableTextTruncated: true } : {}),
    // File-derived shape travels with its contents, never in a higher-authority prompt.
    ...(file.tables ? { tables: file.tables } : {}),
    ...(file.sections ? { sections: file.sections } : {}),
    ...(file.sandboxPath === undefined ? {} : { sandboxPath: file.sandboxPath }),
  }
}
