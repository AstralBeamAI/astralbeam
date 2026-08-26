import { expect, test } from "vitest"

import { normalizeChatAttachments, redactChatAttachmentData } from "./attachments.server"
import type { ChatMessages } from "./types"

const base64 = (text: string) => btoa(text)

/** A real 64x64 PNG, so the signature check is proven against genuine bytes. */
const REAL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwCqpf1ETMxF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj13PLIEAOXyUUwAAAABJRU5ErkJggg=="

function userMessage(content: unknown[]): ChatMessages {
  return [{ id: "user-1", role: "user", content }] as unknown as ChatMessages
}

function contentOf(messages: ChatMessages): Array<Record<string, unknown>> {
  return (messages[0] as unknown as { content: Array<Record<string, unknown>> }).content
}

test("decodes a text document into a framed text entry the model can read", () => {
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    { type: "text", text: "what does this say?" },
    {
      type: "document",
      source: { type: "data", value: base64("hello from a file"), mimeType: "text/markdown" },
      metadata: { filename: "notes.md" },
    },
  ]))
  const entries = contentOf(messages)
  expect(entries[0]).toEqual({ type: "text", text: "what does this say?" })
  expect(entries[1]?.type).toBe("text")
  expect(entries[1]?.text).toContain("notes.md")
  expect(entries[1]?.text).toContain("hello from a file")
  expect(entries[1]?.text).toContain("--- END ATTACHED FILE ---")
  expect(attachments).toEqual([
    { filename: "notes.md", mimeType: "text/markdown", bytes: 17, result: "text" },
  ])
})

test("passes images and PDFs through with a sanitized filename for the provider", () => {
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    {
      type: "image",
      source: { type: "data", value: REAL_PNG, mimeType: "image/png" },
      metadata: { filename: "shot.png" },
    },
    {
      type: "document",
      source: { type: "data", value: base64("%PDF-1.7"), mimeType: "application/pdf" },
      // A newline in a filename would forge line structure in the prompt it lands in.
      metadata: { filename: "re\nport .pdf" },
    },
  ]))
  const entries = contentOf(messages)
  expect(entries[0]?.type).toBe("image")
  expect(entries[1]?.type).toBe("document")
  expect(entries[1]?.metadata).toEqual({ filename: "re port .pdf" })
  expect(attachments.map((attachment) => attachment.result)).toEqual(["image", "pdf"])
})

// The provider adapter throws on a part it cannot map, which would fail the whole run; a refusal
// the model can relay keeps the conversation alive.
test("replaces unsupported attachments with an explanation instead of failing the run", () => {
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    {
      type: "audio",
      source: { type: "data", value: base64("audio"), mimeType: "audio/mpeg" },
      metadata: { filename: "clip.mp3" },
    },
    {
      type: "document",
      source: { type: "data", value: base64("PK"), mimeType: "application/zip" },
      metadata: { filename: "bundle.zip" },
    },
  ]))
  const entries = contentOf(messages)
  expect(entries.every((entry) => entry.type === "text")).toBe(true)
  expect(entries[0]?.text).toContain("clip.mp3")
  expect(entries[1]?.text).toContain("could not be included")
  expect(attachments.map((attachment) => attachment.result)).toEqual(["rejected", "rejected"])
})

// A URL source would have the provider fetch a caller-chosen host on this deployment's API key.
test("refuses attachments that are not inline data", () => {
  const { messages } = normalizeChatAttachments(userMessage([
    { type: "image", source: { type: "url", value: "https://example.test/photo.png" } },
  ]))
  expect(contentOf(messages)[0]?.text).toContain("only files uploaded with the message")
})

test("refuses a binary file mislabeled as text and an oversized one", () => {
  const binary = btoa(String.fromCharCode(0xff, 0xfe, 0xfd))
  const oversized = "A".repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3))
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    {
      type: "document",
      source: { type: "data", value: binary, mimeType: "text/plain" },
      metadata: { filename: "broken.txt" },
    },
    {
      type: "document",
      source: { type: "data", value: oversized, mimeType: "text/plain" },
      metadata: { filename: "huge.log" },
    },
  ]))
  const entries = contentOf(messages)
  expect(entries[0]?.text).toContain("not valid UTF-8 text")
  expect(entries[1]?.text).toContain("larger than the 1.0 MB limit")
  expect(attachments.every((attachment) => attachment.result === "rejected")).toBe(true)
})

test("leaves assistant messages and plain text conversations untouched", () => {
  const messages = [
    { id: "u1", role: "user", content: "hello" },
    { id: "a1", role: "assistant", content: "hi" },
  ] as unknown as ChatMessages
  expect(normalizeChatAttachments(messages)).toEqual({ messages, attachments: [] })
})

test("keeps attachment payloads out of the debug log", () => {
  const redacted = redactChatAttachmentData(userMessage([
    {
      type: "image",
      source: { type: "data", value: base64("x".repeat(4096)), mimeType: "image/png" },
    },
  ]))
  expect((contentOf(redacted)[0]?.source as { value: string }).value).toBe("<4 KB base64>")
})

// The provider adapter rejects a document part that is not a PDF, so a mislabeled file would
// otherwise fail the whole run instead of being read as the image it is.
test("repairs a part whose type contradicts its MIME type", () => {
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    {
      type: "document",
      source: { type: "data", value: REAL_PNG, mimeType: "image/png" },
      metadata: { filename: "shot.png" },
    },
    {
      type: "image",
      source: { type: "data", value: base64("%PDF-1.7"), mimeType: "application/pdf" },
      metadata: { filename: "spec.pdf" },
    },
  ]))
  expect(contentOf(messages).map((entry) => entry.type)).toEqual(["image", "document"])
  expect(attachments.map((attachment) => attachment.result)).toEqual(["image", "pdf"])
})

// A renamed or truncated file used to reach the provider and fail the whole run with an opaque
// 400; it is refused here with an explanation instead, while a genuine file still passes.
test("refuses a payload whose bytes do not match its declared type", () => {
  const { messages, attachments } = normalizeChatAttachments(userMessage([
    {
      type: "image",
      source: { type: "data", value: base64("this is not a png"), mimeType: "image/png" },
      metadata: { filename: "renamed.png" },
    },
    {
      type: "document",
      source: { type: "data", value: base64("this is not a pdf"), mimeType: "application/pdf" },
      metadata: { filename: "renamed.pdf" },
    },
    {
      type: "image",
      source: { type: "data", value: "!!! not base64 !!!", mimeType: "image/png" },
      metadata: { filename: "corrupt.png" },
    },
    {
      type: "image",
      source: { type: "data", value: REAL_PNG, mimeType: "image/png" },
      metadata: { filename: "red.png" },
    },
  ]))
  expect(contentOf(messages).map((entry) => entry.type)).toEqual(["text", "text", "text", "image"])
  expect(contentOf(messages)[0]?.text).toContain("not a image/png file")
  expect(attachments.map((attachment) => attachment.result)).toEqual([
    "rejected",
    "rejected",
    "rejected",
    "image",
  ])
})
