import { expect, test } from "vitest"

import {
  acceptAttachmentFiles,
  classifyAttachmentFile,
  describeSentAttachment,
  resolveAttachmentOptions,
} from "./attachments.ts"
import type { DraftAttachment } from "./types.ts"

const limits = resolveAttachmentOptions(undefined)

function ids() {
  let next = 0
  return () => `attachment-${next++}`
}

// A data or office file's kind decides its size cap and its icon, and the endpoint keys its whole
// delivery on the type sent here, so a `.csv` arriving as `text/plain` would be read as prose.
test("classifies data and office files by extension, whatever the browser reported", () => {
  const expected: Array<[string, string, string]> = [
    ["sales.csv", "application/octet-stream", "text/csv"],
    ["sales.tsv", "", "text/tab-separated-values"],
    ["events.parquet", "", "application/vnd.apache.parquet"],
    ["app.sqlite", "", "application/vnd.sqlite3"],
  ]
  for (const [name, type, mimeType] of expected) {
    expect(classifyAttachmentFile({ name, type, size: 10 }, limits)).toEqual({
      kind: "data",
      mimeType,
    })
  }
  const office: Array<[string, string]> = [
    ["brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["q3.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ]
  for (const [name, mimeType] of office) {
    expect(classifyAttachmentFile({ name, type: mimeType, size: 10 }, limits)).toEqual({
      kind: "office",
      mimeType,
    })
    // Some browsers report nothing for an office file dropped rather than picked.
    expect(classifyAttachmentFile({ name, type: "", size: 10 }, limits)).toEqual({
      kind: "office",
      mimeType,
    })
  }
})

test("holds a data file to its own size cap, not a text file's", () => {
  const twoMegabytes = 2 * 1024 * 1024
  const [csv, markdown] = acceptAttachmentFiles({
    files: [
      { name: "big.csv", type: "text/csv", size: twoMegabytes },
      { name: "big.md", type: "text/markdown", size: twoMegabytes },
    ],
    existing: [],
    limits,
    createId: ids(),
  })
  expect(csv?.draft.status).toBe("reading")
  expect(markdown?.draft.error).toBe("Too large (max 1.0 MB)")
})

// Chrome reports `.ts` as `video/mp2t` and leaves `.tsx` empty, which would send a source file
// as an unreadable video part or reject it outright.
test("corrects the browser's MIME guess for source files", () => {
  expect(
    classifyAttachmentFile({ name: "agent.ts", type: "video/mp2t", size: 10 }, limits),
  ).toEqual({ kind: "text", mimeType: "text/plain" })
  expect(classifyAttachmentFile({ name: "widget.tsx", type: "", size: 10 }, limits)).toEqual({
    kind: "text",
    mimeType: "text/plain",
  })
})

// A repo file with no extension has nothing but its name to go by, and browsers report no type.
test("recognizes text files that carry no extension", () => {
  for (const name of ["Dockerfile", "LICENSE", "Makefile", ".gitignore", ".env.production"]) {
    expect(classifyAttachmentFile({ name, type: "", size: 10 }, limits)).toEqual({
      kind: "text",
      mimeType: "text/plain",
    })
  }
  expect(classifyAttachmentFile({ name: "photo", type: "", size: 10 }, limits)).toEqual({
    error: "Unsupported file type",
  })
})

test("honors a host-narrowed accept list", () => {
  const imagesOnly = resolveAttachmentOptions({ accept: ["image/*"] })
  expect(
    classifyAttachmentFile({ name: "shot.png", type: "image/png", size: 10 }, imagesOnly),
  ).toEqual({ kind: "image", mimeType: "image/png" })
  expect(
    classifyAttachmentFile({ name: "spec.pdf", type: "application/pdf", size: 10 }, imagesOnly),
  ).toEqual({ error: "This chat does not accept that file type" })
})

test("rejects files past the count, per-file, and total limits", () => {
  const files = [
    { name: "a.png", type: "image/png", size: 1024 },
    { name: "huge.png", type: "image/png", size: 6 * 1024 * 1024 },
    { name: "b.png", type: "image/png", size: 1024 },
    { name: "c.png", type: "image/png", size: 1024 },
    { name: "d.png", type: "image/png", size: 1024 },
    { name: "e.png", type: "image/png", size: 1024 },
    { name: "f.png", type: "image/png", size: 1024 },
  ]
  const picked = acceptAttachmentFiles({ files, existing: [], limits, createId: ids() })
  expect(picked.map(({ draft }) => draft.status)).toEqual([
    "reading",
    "error",
    "reading",
    "reading",
    "reading",
    "reading",
    "error",
  ])
  expect(picked[1]?.draft.error).toBe("Too large (max 5.0 MB)")
  expect(picked[6]?.draft.error).toBe("Up to 5 files per message")
})

test("counts already-picked files against the limits", () => {
  const existing: DraftAttachment[] = [
    {
      id: "kept",
      name: "a.pdf",
      size: 9 * 1024 * 1024,
      mimeType: "application/pdf",
      kind: "pdf",
      status: "ready",
    },
    {
      id: "rejected",
      name: "b.mp3",
      size: 4 * 1024 * 1024,
      mimeType: "audio/mpeg",
      status: "error",
      error: "Unsupported file type",
    },
  ]
  const totalLimits = resolveAttachmentOptions({ maxTotalBytes: 10 * 1024 * 1024 })
  const picked = acceptAttachmentFiles({
    files: [{ name: "c.pdf", type: "application/pdf", size: 2 * 1024 * 1024 }],
    existing,
    limits: totalLimits,
    createId: ids(),
  })
  // The ready PDF counts toward the total; the rejected file never will be sent, so it does not.
  expect(picked[0]?.draft.error).toBe("Over the 10 MB message limit")
})

// The href becomes an <img src> and a download anchor, so a part carrying an active scheme, or
// bytes of a type this chat never sends, must reach neither — whoever built the transcript.
test("a sent attachment points only at data the composer itself sends", () => {
  expect(
    describeSentAttachment({
      type: "document",
      source: { type: "url", value: "", mimeType: "text/plain", byteSize: 11 },
      metadata: { size: 999 },
    }).description,
  ).toBe("11 B")
  const href = (value: string, mimeType?: string, type?: string) =>
    describeSentAttachment({
      type: "document",
      source: { value, ...(mimeType ? { mimeType } : {}), ...(type ? { type } : {}) },
    }).href

  expect(href("cGRm", "application/pdf")).toBe("data:application/pdf;base64,cGRm")
  expect(href("data:image/png;base64,aW1n")).toBe("data:image/png;base64,aW1n")
  expect(href("data:application/octet-stream;base64,AAAA")).toBeUndefined()
  expect(href("javascript:alert(1)")).toBeUndefined()
  expect(href("")).toBeUndefined()
  expect(href("https://example.com/image.png", "image/png", "url")).toBe(
    "https://example.com/image.png",
  )
  expect(href("file-provider-handle", "image/png", "file")).toBeUndefined()
  expect(
    describeSentAttachment({
      type: "audio",
      source: { type: "data", value: "AAAA", mimeType: "audio/mpeg" },
    }).href,
  ).toBe("data:audio/mpeg;base64,AAAA")
  expect(href("javascript:alert(1)", "image/png", "url")).toBeUndefined()
})
