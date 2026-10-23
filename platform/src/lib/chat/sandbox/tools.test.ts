import { describe, expect, it, vi } from "vitest"

import { Context, Effect } from "effect"
import type { SandboxFsOptions, SandboxHandle } from "@tanstack/ai-sandbox"

import { CHAT_SANDBOX_MAX_ARTIFACT_BYTES } from "./constants.ts"
import { clampSandboxText, createChatSandboxTools } from "./tools.ts"

describe("clampSandboxText", () => {
  it("elides the middle so a failing command's last line survives", () => {
    const clamped = clampSandboxText(`${"a".repeat(50)}THE-ERROR`, 20)
    expect(clamped.truncated).toBe(true)
    expect(clamped.text).toContain("characters omitted")
    expect(clamped.text.endsWith("THE-ERROR")).toBe(true)
  })
})

it.each([
  { size: CHAT_SANDBOX_MAX_ARTIFACT_BYTES + 1, bytes: 0, reads: 0, published: false },
  { size: 4, bytes: CHAT_SANDBOX_MAX_ARTIFACT_BYTES + 1, reads: 1, published: false },
  { size: 4, bytes: 4, reads: 1, published: true },
  { size: new Error("Provider metadata unavailable"), bytes: 0, reads: 0, published: false },
])(
  "publishes only readable artifacts within the size limit: %j",
  async ({ size, bytes, reads, published }) => {
    const readBytes = vi.fn(() => Promise.resolve(new Uint8Array(bytes)))
    const publish = vi.fn(() => Effect.succeed("stored-file"))
    const lstat = vi.fn((_path: string, _options?: SandboxFsOptions) =>
      size instanceof Error ? Promise.reject(size) : Promise.resolve({ type: "file", size }),
    )
    const handle = {
      workspaceRoot: "/workspace",
      fs: { lstat, readBytes },
    } as unknown as SandboxHandle
    const tools = createChatSandboxTools({
      session: { acquire: () => Effect.succeed(handle), prepareUploads: () => Effect.void },
      services: Context.empty(),
      publishArtifact: publish,
    })
    const tool = tools.find((tool) => tool.name === "sandbox_publish_artifact")!
    const result: unknown = await tool.execute!({ path: "result.txt" })
    expect(readBytes).toHaveBeenCalledTimes(reads)
    expect(publish).toHaveBeenCalledTimes(published ? 1 : 0)
    expect(lstat.mock.calls[0]?.[0]).toBe("/workspace/result.txt")
    expect(lstat.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(result).toHaveProperty(
      published ? "fileId" : "refusal",
      published
        ? "stored-file"
        : size instanceof Error
          ? "The file could not be read. Check the path with sandbox_list_files."
          : `Artifacts are limited to ${CHAT_SANDBOX_MAX_ARTIFACT_BYTES} bytes. Compress or split the file.`,
    )
  },
)
