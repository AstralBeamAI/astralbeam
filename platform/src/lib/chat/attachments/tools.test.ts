import { expect, test } from "vitest"

import { createChatAttachmentTools } from "./tools"
import { CHAT_ATTACHMENT_READ_MAX_CHARACTERS } from "./constants"
import type { ChatAttachmentFile } from "./types"

const LONG_TEXT = "abcdefghij".repeat(CHAT_ATTACHMENT_READ_MAX_CHARACTERS / 10 + 100)

function file(text = "hello", handle = "notes.md"): ChatAttachmentFile {
  return {
    handle,
    filename: handle,
    mimeType: "text/markdown",
    bytes: new Uint8Array(),
    text,
  }
}

async function read(
  files: readonly ChatAttachmentFile[],
  input: { file: string; offset?: number; limit?: number },
  sandbox = true,
) {
  const [tool] = createChatAttachmentTools(files, { sandbox })
  return (await tool?.execute?.(input)) as Record<string, unknown>
}

test("pages a long text file without a sandbox and reports where to continue", async () => {
  const files = [file(LONG_TEXT)]
  const first = await read(
    files,
    { file: "notes.md", limit: CHAT_ATTACHMENT_READ_MAX_CHARACTERS * 10 },
    false,
  )
  expect(first.content).toHaveLength(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
  expect(first.end).toBe(false)
  expect(first.nextOffset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
  expect(first.sandboxPath).toBeUndefined()

  const second = await read(files, { file: "notes.md", offset: first.nextOffset as number }, false)
  expect(second.offset).toBe(CHAT_ATTACHMENT_READ_MAX_CHARACTERS)
  expect(second.content).toBe(LONG_TEXT.slice(CHAT_ATTACHMENT_READ_MAX_CHARACTERS))
  expect(second.end).toBe(true)
})

test("names the available handles when the agent guesses one wrong", async () => {
  const result = await read([file("hello", "a.md"), file("hello", "b.md")], {
    file: "notes.md",
  })
  expect(result.refusal).toContain('no attached file with the handle "notes.md"')
  expect(result.refusal).toContain('"a.md", "b.md"')
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
