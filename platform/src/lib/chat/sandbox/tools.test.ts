import { describe, expect, it, vi } from "vitest"

import { Context, Effect } from "effect"
import type { SandboxHandle } from "@tanstack/ai-sandbox"

import { clampSandboxText, createChatSandboxTools } from "./tools.ts"

describe("clampSandboxText", () => {
  it("passes text within the cap through untouched", () => {
    expect(clampSandboxText("hello", 10)).toEqual({ text: "hello", truncated: false })
  })

  it("elides the middle so a failing command's last line survives", () => {
    const clamped = clampSandboxText(`${"a".repeat(50)}THE-ERROR`, 20)
    expect(clamped.truncated).toBe(true)
    expect(clamped.text).toContain("characters omitted")
    expect(clamped.text.endsWith("THE-ERROR")).toBe(true)
  })
})

it("publishes a stored reference only after copying the sandbox bytes", async () => {
  const bytes = new TextEncoder().encode("Durable report")
  const handle = {
    id: "sandbox",
    workspaceRoot: "/workspace",
    fs: {
      readBytes: () => Promise.resolve(bytes),
    },
  } as unknown as SandboxHandle
  let finish!: (id: string) => void
  const persisted = new Promise<string>((resolve) => {
    finish = resolve
  })
  const publishArtifact = vi.fn(() => Effect.promise(() => persisted))
  const tool = createChatSandboxTools({
    session: { acquire: () => Effect.succeed(handle), prepareUploads: () => Effect.void },
    services: Context.empty(),
    publishArtifact,
  }).find((tool) => tool.name === "sandbox_publish_artifact")!
  const settled = vi.fn()
  const publishing = Promise.resolve(tool.execute!({ path: "report.txt" })).then(
    (result: unknown) => {
      settled()
      return result
    },
  )
  await vi.waitFor(() => expect(publishArtifact).toHaveBeenCalledWith(bytes))
  expect(settled).not.toHaveBeenCalled()
  finish("stored-file")
  await expect(publishing).resolves.toEqual({
    fileId: "stored-file",
    path: "/workspace/report.txt",
    relativePath: "report.txt",
    mimeType: "text/plain",
    size: bytes.length,
  })
})
