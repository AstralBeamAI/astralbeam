import { expect, test } from "vitest"

import { createChatAttachmentTools } from "./attachment-tools.server"
import { CHAT_ATTACHMENT_READ_MAX_CHARACTERS } from "./constants.server"
import type { ChatAttachmentFile } from "./types"

const LONG_TEXT = "abcdefghij".repeat(CHAT_ATTACHMENT_READ_MAX_CHARACTERS / 10 + 100)

/** A readable file: the common case, with the text and handle a test cares about. */
function file(text = "hello", handle = "notes.md"): ChatAttachmentFile {
  return {
    handle,
    filename: handle,
    mimeType: "text/markdown",
    bytes: new Uint8Array(),
    text,
    sandboxPath: `uploads/${handle}`,
    card: "card",
  }
}

/** A file with no text view, optionally without a sandbox to open it in either. */
function opaqueFile(options: { sandbox: boolean }): ChatAttachmentFile {
  return {
    handle: "events.parquet",
    filename: "events.parquet",
    mimeType: "application/vnd.apache.parquet",
    bytes: new Uint8Array(),
    card: "card",
    ...(options.sandbox ? { sandboxPath: "uploads/events.parquet" } : {}),
  }
}

/** Runs `read_attachment` over a set of files, the way the model reaches it. */
async function read(
  files: readonly ChatAttachmentFile[],
  input: { file: string; offset?: number; limit?: number },
) {
  const [tool] = createChatAttachmentTools({ files })
  return await tool?.execute?.(input) as Record<string, unknown>
}

// An agent should not be offered a reader when there is nothing to read.
test("declares no tool for a run with no files", () => {
  expect(createChatAttachmentTools({ files: [] })).toEqual([])
  expect(createChatAttachmentTools({ files: [file()] })).toHaveLength(1)
})

test("reads a file's text by handle", async () => {
  const result = await read([file()], { file: "notes.md" })
  expect(result).toMatchObject({
    file: "notes.md",
    content: "hello",
    offset: 0,
    totalCharacters: 5,
    end: true,
  })
  expect(result.nextOffset).toBeUndefined()
})

// Paging is what replaces truncation: a long file is fully readable rather than cut off, which is
// the whole reason contents are not pasted into the prompt.
test("pages a long file and reports where to continue", async () => {
  const files = [file(LONG_TEXT)]
  const first = await read(files, { file: "notes.md" })
  expect(first.content).toHaveLength(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
  expect(first.end).toBe(false)
  expect(first.nextOffset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)

  const second = await read(files, { file: "notes.md", offset: first.nextOffset as number })
  expect(second.offset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
  expect(second.content).toBe(LONG_TEXT.slice(CHAT_ATTACHMENT_READ_MAX_CHARACTERS))
  expect(second.end).toBe(true)
})

// The page size is model context, not a preference, so an agent asking for more gets the cap.
test("caps a page however much the agent asks for", async () => {
  const result = await read([file(LONG_TEXT)], {
    file: "notes.md",
    limit: CHAT_ATTACHMENT_READ_MAX_CHARACTERS * 10,
  })
  expect(result.content).toHaveLength(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
})

test("clamps an offset past the end instead of failing", async () => {
  const result = await read([file()], { file: "notes.md", offset: 9999 })
  expect(result).toMatchObject({ content: "", offset: 5, end: true })
})

test("names the available handles when the agent guesses one wrong", async () => {
  const result = await read([file("hello", "a.csv"), file("hello", "b.csv")], {
    file: "sales.csv",
  })
  expect(result.refusal).toContain('no attached file with the handle "sales.csv"')
  expect(result.refusal).toContain('"a.csv", "b.csv"')
})

test("sends the agent to the sandbox for a file with no text view", async () => {
  const sandboxed = opaqueFile({ sandbox: true })
  expect((await read([sandboxed], { file: "events.parquet" })).refusal).toContain(
    "Open it with code in the sandbox at uploads/events.parquet",
  )
  const unsandboxed = opaqueFile({ sandbox: false })
  expect((await read([unsandboxed], { file: "events.parquet" })).refusal).toContain(
    "no sandbox to open it in",
  )
})
