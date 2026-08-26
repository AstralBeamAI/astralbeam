import { expect, test } from "vitest"

import {
  acceptAttachmentFiles,
  attachmentContentParts,
  classifyAttachmentFile,
  resolveAttachmentOptions,
} from "./attachments.ts"
import type { DraftAttachment } from "./types.ts"

const limits = resolveAttachmentOptions(undefined)

function ids() {
  let next = 0
  return () => `attachment-${next++}`
}

test("classifies the file types the chat endpoint can read", () => {
  expect(classifyAttachmentFile({ name: "shot.png", type: "image/png", size: 10 }, limits))
    .toEqual({ kind: "image", mimeType: "image/png" })
  expect(classifyAttachmentFile({ name: "spec.pdf", type: "application/pdf", size: 10 }, limits))
    .toEqual({ kind: "pdf", mimeType: "application/pdf" })
  expect(classifyAttachmentFile({ name: "notes.md", type: "text/markdown", size: 10 }, limits))
    .toEqual({ kind: "text", mimeType: "text/markdown" })
  expect(classifyAttachmentFile({ name: "clip.mp3", type: "audio/mpeg", size: 10 }, limits))
    .toEqual({ error: "Unsupported file type" })
})

// Chrome reports `.ts` as `video/mp2t` and leaves `.tsx` empty, which would send a source file
// as an unreadable video part or reject it outright.
test("corrects the browser's MIME guess for source files", () => {
  expect(classifyAttachmentFile({ name: "agent.ts", type: "video/mp2t", size: 10 }, limits))
    .toEqual({ kind: "text", mimeType: "text/plain" })
  expect(classifyAttachmentFile({ name: "widget.tsx", type: "", size: 10 }, limits))
    .toEqual({ kind: "text", mimeType: "text/plain" })
})

// A repo file with no extension has nothing but its name to go by, and browsers report no type.
test("recognizes text files that carry no extension", () => {
  for (const name of ["Dockerfile", "LICENSE", "Makefile", ".gitignore", ".env.production"]) {
    expect(classifyAttachmentFile({ name, type: "", size: 10 }, limits))
      .toEqual({ kind: "text", mimeType: "text/plain" })
  }
  expect(classifyAttachmentFile({ name: "photo", type: "", size: 10 }, limits))
    .toEqual({ error: "Unsupported file type" })
})

test("honors a host-narrowed accept list", () => {
  const imagesOnly = resolveAttachmentOptions({ accept: ["image/*"] })
  expect(classifyAttachmentFile({ name: "shot.png", type: "image/png", size: 10 }, imagesOnly))
    .toEqual({ kind: "image", mimeType: "image/png" })
  expect(
    classifyAttachmentFile({ name: "spec.pdf", type: "application/pdf", size: 10 }, imagesOnly),
  )
    .toEqual({ error: "This chat does not accept that file type" })
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
      data: "AA==",
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

test("sends images as image parts and everything else as named documents", () => {
  const attachments: DraftAttachment[] = [
    {
      id: "1",
      name: "shot.png",
      size: 12,
      mimeType: "image/png",
      kind: "image",
      status: "ready",
      data: "aW1n",
    },
    {
      id: "2",
      name: "spec.pdf",
      size: 34,
      mimeType: "application/pdf",
      kind: "pdf",
      status: "ready",
      data: "cGRm",
    },
    {
      id: "3",
      name: "notes.md",
      size: 56,
      mimeType: "text/markdown",
      kind: "text",
      status: "reading",
    },
    {
      id: "4",
      name: "clip.mp3",
      size: 78,
      mimeType: "audio/mpeg",
      status: "error",
      error: "Unsupported file type",
    },
  ]
  expect(attachmentContentParts(attachments)).toEqual([
    {
      type: "image",
      source: { type: "data", value: "aW1n", mimeType: "image/png" },
      metadata: { filename: "shot.png", size: 12 },
    },
    {
      type: "document",
      source: { type: "data", value: "cGRm", mimeType: "application/pdf" },
      metadata: { filename: "spec.pdf", size: 34 },
    },
  ])
})

test("attachments are on unless the host turns them off", () => {
  expect(resolveAttachmentOptions(undefined).enabled).toBe(true)
  expect(resolveAttachmentOptions(true).enabled).toBe(true)
  expect(resolveAttachmentOptions({ maxFiles: 2 }).enabled).toBe(true)
  expect(resolveAttachmentOptions(false).enabled).toBe(false)
  expect(resolveAttachmentOptions({ enabled: false }).enabled).toBe(false)
})
