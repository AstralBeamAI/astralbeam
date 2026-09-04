import { type AnyServerTool, toolDefinition } from "@tanstack/ai"
import * as Schema from "effect/Schema"

import { CHAT_ATTACHMENT_READ_MAX_CHARACTERS } from "./constants.server"
import type { ChatAttachmentFile, DebugLog } from "./types"

/**
 * The tool that gives an attached file's contents to the agent.
 *
 * A file's bytes never enter the prompt, so this is the only way its text reaches the model — and
 * that is the point. Contents arrive as a tool result the agent asked for rather than as text
 * quoted into the user's turn, which keeps a file from impersonating the user's instructions, and
 * paging replaces truncation, so a long file is fully readable instead of cut off at a cap.
 *
 * It reads the run's own attachments, which are already decoded in memory, so it needs no sandbox
 * and works for every agent.
 */

const ReadAttachmentInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Schema.Struct({
    file: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({
      description: "Handle of the attached file, exactly as its card gives it.",
    }),
    offset: Schema.optionalKey(
      Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
        description: "Character to start at. Defaults to the beginning of the file.",
      }),
    ),
    limit: Schema.optionalKey(
      Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))).annotate({
        description:
          `Characters to read, up to ${CHAT_ATTACHMENT_READ_MAX_CHARACTERS}, which is the default.`,
      }),
    ),
  })),
)

/**
 * Declares `read_attachment` over the files this run carries, or nothing when it carries none —
 * an agent should not be offered a tool with nothing to read.
 */
export function createChatAttachmentTools(
  input: { readonly files: readonly ChatAttachmentFile[]; readonly log?: DebugLog | undefined },
): AnyServerTool[] {
  const { files, log } = input
  if (files.length === 0) return []
  const byHandle = new Map(files.map((file) => [file.handle, file]))

  const readAttachment = toolDefinition({
    name: "read_attachment",
    description:
      "Read the text of a file the user attached, by the handle its card gives. Long files come " +
      "back a page at a time: read on from `nextOffset` until `end` is true.",
    inputSchema: ReadAttachmentInputSchema,
  }).server(({ file: handle, offset = 0, limit }) => {
    const file = byHandle.get(handle)
    if (!file) {
      return Promise.resolve({
        refusal: `There is no attached file with the handle "${handle}". The attached files are: ${
          files.map((candidate) => `"${candidate.handle}"`).join(", ")
        }.`,
      })
    }
    if (file.text === undefined) {
      return Promise.resolve({
        refusal: file.sandboxPath === undefined
          ? `"${handle}" is a ${file.mimeType} file with no text to read, and this agent has no ` +
            "sandbox to open it in. Tell the user you cannot read that file."
          : `"${handle}" is a ${file.mimeType} file with no text to read. Open it with code in ` +
            `the sandbox at ${file.sandboxPath} instead.`,
      })
    }
    // A page is bounded whatever the agent asks for: the limit is model context, not a preference.
    const start = Math.min(Math.floor(offset), file.text.length)
    const size = Math.min(
      limit === undefined ? CHAT_ATTACHMENT_READ_MAX_CHARACTERS : Math.floor(limit),
      CHAT_ATTACHMENT_READ_MAX_CHARACTERS,
    )
    const content = file.text.slice(start, start + size)
    const end = start + content.length
    log?.("attachment", `read ${handle} [${start}, ${end})`, { characters: content.length })
    return Promise.resolve({
      file: handle,
      filename: file.filename,
      mimeType: file.mimeType,
      content,
      offset: start,
      totalCharacters: file.text.length,
      end: end >= file.text.length,
      ...(end >= file.text.length ? {} : { nextOffset: end }),
    })
  })

  return [readAttachment]
}
