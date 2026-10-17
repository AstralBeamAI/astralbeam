import { expect, test } from "vitest"

import { createChatAttachmentTools } from "./tools"
import { CHAT_ATTACHMENT_READ_MAX_CHARACTERS } from "./constants"
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
  }
}

/** Runs `read_attachment` over a set of files, the way the model reaches it. */
async function read(
  files: readonly ChatAttachmentFile[],
  input: { file: string; offset?: number; limit?: number | undefined },
  sandbox = true,
) {
  const [tool] = createChatAttachmentTools(files, { sandbox })
  return (await tool?.execute?.(input)) as Record<string, unknown>
}

// An agent should not be offered a reader when there is nothing to read.
test("declares no tool for a run with no files", () => {
  expect(createChatAttachmentTools([], { sandbox: false })).toEqual([])
})

test("reads text by handle and reports truncation without advertising an unavailable sandbox", async () => {
  const result = await read([{ ...file(), truncated: true }], { file: "notes.md" }, false)
  expect(result).toMatchObject({
    file: "notes.md",
    content: "hello",
    offset: 0,
    totalCharacters: 5,
    end: true,
    readableTextTruncated: true,
  })
  expect(result.nextOffset).toBeUndefined()
  expect(result.sandboxPath).toBeUndefined()
})

test.each([undefined, CHAT_ATTACHMENT_READ_MAX_CHARACTERS * 10])(
  "pages a long file within the cap for requested limit %s",
  async (limit) => {
    const files = [file(LONG_TEXT)]
    const first = await read(files, { file: "notes.md", limit })
    expect(first.content).toHaveLength(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
    expect(first.end).toBe(false)
    expect(first.nextOffset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)

    const second = await read(files, { file: "notes.md", offset: first.nextOffset as number })
    expect(second.offset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
    expect(second.content).toBe(LONG_TEXT.slice(CHAT_ATTACHMENT_READ_MAX_CHARACTERS))
    expect(second.end).toBe(true)
  },
)

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
  const files: ChatAttachmentFile[] = [
    {
      handle: "events.parquet",
      filename: "events.parquet",
      mimeType: "application/vnd.apache.parquet",
      bytes: new Uint8Array(),
    },
  ]
  const available = await read(files, { file: "events.parquet" })
  expect(available.sandboxPath).toBe("uploads/events.parquet")
  expect(available.refusal).toContain("Open it with code in the sandbox")
  const unavailable = await read(files, { file: "events.parquet" }, false)
  expect(unavailable.refusal).toContain("no sandbox")
  expect(unavailable.sandboxPath).toBeUndefined()
})
