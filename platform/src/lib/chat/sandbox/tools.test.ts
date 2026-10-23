import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import type { ProcessOptions, SandboxFsOptions, SandboxHandle } from "@tanstack/ai-sandbox"
import { Context, Effect } from "effect"
import { afterAll, assert, beforeAll, describe, expect, it, vi } from "vitest"

import { CHAT_SANDBOX_MAX_ARTIFACT_BYTES } from "./constants.ts"
import { clampSandboxText, createChatSandboxTools } from "./tools.ts"

const execSandboxTestFile = promisify(execFile)
let workspace: string

beforeAll(async () => {
  workspace = await mkdtemp(`${tmpdir()}/astralbeam-sandbox-tools-`)
  await Promise.all([
    writeFile(`${workspace}/lines.txt`, "one\ntwo\nthree\nfour\n"),
    writeFile(`${workspace}/empty.txt`, ""),
    writeFile(`${workspace}/long.txt`, "a".repeat(200_000) + "THE-END\n"),
  ])
})

afterAll(() => rm(workspace, { recursive: true, force: true }))

function sandboxToolsFixture() {
  const fs = { read: vi.fn() }
  const exec = vi.fn(async (command: string, options?: ProcessOptions) => {
    const output = await execSandboxTestFile("sh", ["-c", command], {
      cwd: options?.cwd ?? workspace,
      signal: options?.signal,
      maxBuffer: 1024 * 1024,
    })
    return { ...output, exitCode: 0 }
  })
  const handle = {
    id: "sandbox-tools-test",
    provider: "test",
    workspaceRoot: workspace,
    capabilities: { backgroundProcesses: false },
    process: { exec },
    fs,
  } as unknown as SandboxHandle
  const tools = createChatSandboxTools({
    session: { acquire: () => Effect.succeed(handle), prepareUploads: () => Effect.void },
    services: Context.empty(),
    publishArtifact: () => Effect.succeed("stored-file"),
  })
  return {
    fs,
    exec,
    tool: (name: string) => {
      const tool = tools.find((tool) => tool.name === `sandbox_${name}`)!
      return { ...tool, execute: tool.execute! }
    },
  }
}

describe("sandbox file tools", () => {
  it("pages through a virtual workspace path without reading the whole file", async () => {
    const { tool, fs, exec } = sandboxToolsFixture()
    const read = tool("read_file")
    expect(await read.execute({ path: "/workspace/lines.txt", limit: 2 }, undefined)).toEqual({
      path: `${workspace}/lines.txt`,
      relativePath: "lines.txt",
      content: "one\ntwo",
      truncated: true,
      offset: 1,
      nextOffset: 3,
    })
    expect(await read.execute({ path: "lines.txt", offset: 3 }, undefined)).toMatchObject({
      content: "three\nfour",
      truncated: false,
      offset: 3,
      totalLines: 4,
    })
    expect(fs.read).not.toHaveBeenCalled()
    expect(exec.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal)
    const before = exec.mock.calls.length
    expect(await read.execute({ path: "../outside" }, undefined)).toHaveProperty("refusal")
    expect(exec).toHaveBeenCalledTimes(before)
  })

  it("handles empty files and applies our content limit to an oversized upstream line", async () => {
    const { tool } = sandboxToolsFixture()
    const read = tool("read_file")
    expect(await read.execute({ path: "empty.txt" }, undefined)).toMatchObject({
      content: "",
      totalLines: 0,
      truncated: false,
    })
    const result = (await read.execute({ path: "long.txt" }, undefined)) as {
      content: string
      truncated: boolean
    }
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThan(40_100)
    expect(result.content).toContain("characters omitted")
    expect(result.content).toMatch(/THE-END$/)
  })

  it("forwards cancellation to the paged read", async () => {
    const { tool, exec } = sandboxToolsFixture()
    const started = Promise.withResolvers<AbortSignal>()
    exec.mockImplementation(
      (_command, options) =>
        new Promise<never>((_resolve, reject) => {
          assert(options?.signal)
          started.resolve(options.signal)
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          )
        }),
    )
    const controller = new AbortController()
    const pending = Promise.resolve(
      tool("read_file").execute(
        { path: "lines.txt" },
        {
          emitCustomEvent: vi.fn(),
          abortSignal: controller.signal,
        },
      ),
    )
    const rejected = pending.then(
      () => false,
      () => true,
    )
    const signal = await started.promise
    controller.abort()
    expect(await rejected).toBe(true)
    expect(signal.aborted).toBe(true)
  })
})

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
