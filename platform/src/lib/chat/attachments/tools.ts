import { type AnyServerTool, toolDefinition } from "@tanstack/ai"
import * as Schema from "effect/Schema"
import { NonEmptyStringSchema } from "@/lib/schemas.ts"

import { CHAT_ATTACHMENT_READ_MAX_CHARACTERS, CHAT_ATTACHMENT_UPLOAD_DIRECTORY } from "./constants"
import type { ChatAttachmentFile } from "./types"
import { chatToolInputSchema } from "../tool-schema"

const ReadAttachmentInputSchema = chatToolInputSchema(
  Schema.Struct({
    file: NonEmptyStringSchema.annotate({
      description: "Name of the attached file, exactly as the user's message gives it.",
    }),
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

export function createChatAttachmentTools(
  files: readonly ChatAttachmentFile[],
  options: { readonly sandbox: boolean },
): AnyServerTool[] {
  if (files.length === 0) return []
  const byHandle = new Map(files.map((file) => [file.handle, file]))

  const readAttachment = toolDefinition({
    name: "read_attachment",
    description:
      "Read the text of a file the user attached, by the name shown in their message. Answers " +
      "with the file's type, size, and available sandbox path. Office and opaque data files " +
      "must be opened with code in the sandbox. Long files come back a page at a time: read on from " +
      "`nextOffset` until `end` is true.",
    inputSchema: ReadAttachmentInputSchema,
  }).server(({ file: handle, offset = 0, limit = CHAT_ATTACHMENT_READ_MAX_CHARACTERS }) => {
    const file = byHandle.get(handle)
    if (!file) {
      return {
        refusal: `There is no attached file with the handle "${handle}". The attached files are: ${files
          .map((candidate) => `"${candidate.handle}"`)
          .join(", ")}.`,
      }
    }
    const metadata = {
      file: handle,
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes.length,
      ...(options.sandbox ? { sandboxPath: `${CHAT_ATTACHMENT_UPLOAD_DIRECTORY}/${handle}` } : {}),
    }
    if (file.text === undefined) {
      return {
        ...metadata,
        refusal: options.sandbox
          ? `"${handle}" has no text view. Open it with code in the sandbox at ${metadata.sandboxPath}.`
          : `"${handle}" has no text view and no sandbox is available to open it. Tell the user you cannot read that file.`,
      }
    }
    // A page is bounded whatever the agent asks for: the limit is model context, not a preference.
    const start = Math.min(offset, file.text.length)
    const size = Math.min(limit, CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
    const content = file.text.slice(start, start + size)
    const stop = start + content.length
    const done = stop >= file.text.length
    return {
      ...metadata,
      content,
      offset: start,
      totalCharacters: file.text.length,
      end: done,
      ...(done ? {} : { nextOffset: stop }),
      ...(file.truncated ? { readableTextTruncated: true } : {}),
    }
  })

  return [readAttachment]
}
