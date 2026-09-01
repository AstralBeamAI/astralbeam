import type { UIMessage } from "@tanstack/ai-client"
import { describe, expect, it } from "vitest"

import { SANDBOX_RUN_COMMAND_TOOL, SANDBOX_WRITE_FILE_TOOL } from "./protocol.ts"
import { collectSandboxActivity, describeSandboxCommandRun } from "./sandbox.ts"

function toolCall(
  input: { id: string; name: string; input?: unknown; output?: unknown; state?: string },
): UIMessage {
  return {
    id: `message-${input.id}`,
    role: "assistant",
    parts: [{
      type: "tool-call",
      id: input.id,
      name: input.name,
      state: input.state ?? "complete",
      input: input.input,
      output: input.output,
    }],
  } as unknown as UIMessage
}

describe("collectSandboxActivity", () => {
  it("keeps the latest content per path so the panel shows what is in the sandbox now", () => {
    // The agent asked for the same file two ways; the result's own path is what identifies it, so
    // this is one file rather than two.
    const activity = collectSandboxActivity([
      toolCall({
        id: "1",
        name: SANDBOX_WRITE_FILE_TOOL,
        input: { path: "/workspace/app.py", content: "print(1)" },
        output: { path: "/home/daytona/workspace/app.py", relativePath: "app.py" },
      }),
      toolCall({
        id: "2",
        name: SANDBOX_WRITE_FILE_TOOL,
        input: { path: "app.py", content: "print(1)\nprint(2)" },
        output: { path: "/home/daytona/workspace/app.py", relativePath: "app.py" },
      }),
    ])
    expect(activity.files).toHaveLength(1)
    expect(activity.files[0]).toMatchObject({
      path: "/home/daytona/workspace/app.py",
      label: "app.py",
      content: "print(1)\nprint(2)",
      lines: 2,
    })
  })

  it("labels a write with its absolute path until the result reports a shorter one", () => {
    const activity = collectSandboxActivity([
      toolCall({
        id: "1",
        name: SANDBOX_WRITE_FILE_TOOL,
        input: { path: "/workspace/app.py", content: "print(1)" },
        output: { path: "/workspace/app.py" },
      }),
    ])
    expect(activity.files[0]).toMatchObject({
      path: "/workspace/app.py",
      label: "/workspace/app.py",
    })
  })

  it("leaves out a write that is still streaming or was refused", () => {
    const activity = collectSandboxActivity([
      toolCall({
        id: "1",
        name: SANDBOX_WRITE_FILE_TOOL,
        state: "input-streaming",
        input: { path: "/workspace/partial.py", content: "prin" },
      }),
      toolCall({
        id: "2",
        name: SANDBOX_WRITE_FILE_TOOL,
        input: { path: "/etc/passwd", content: "x" },
        output: { refusal: "Only paths under /workspace can be used here." },
      }),
    ])
    expect(activity.files).toEqual([])
  })

  it("records every command in order, including one still running", () => {
    const activity = collectSandboxActivity([
      toolCall({
        id: "1",
        name: SANDBOX_RUN_COMMAND_TOOL,
        input: { command: "python app.py" },
        output: { command: "python app.py", exitCode: 0, stdout: "3\n", stderr: "" },
      }),
      toolCall({
        id: "2",
        name: SANDBOX_RUN_COMMAND_TOOL,
        state: "input-complete",
        input: { command: "sleep 5" },
      }),
    ])
    expect(activity.commands.map((run) => run.command)).toEqual(["python app.py", "sleep 5"])
    expect(activity.commands[0]).toMatchObject({ exitCode: 0, stdout: "3\n", finished: true })
    expect(activity.commands[1]).toMatchObject({ finished: false })
  })

  it("ignores tool calls that are not the endpoint's sandbox tools", () => {
    const activity = collectSandboxActivity([
      toolCall({ id: "1", name: "create_todo", input: { text: "write code" }, output: { id: 4 } }),
    ])
    expect(activity).toEqual({ files: [], commands: [] })
  })
})

describe("describeSandboxCommandRun", () => {
  it("summarizes the exit code, the duration, and a truncated log", () => {
    expect(describeSandboxCommandRun({
      toolCallId: "1",
      command: "npm test",
      stdout: "",
      stderr: "",
      exitCode: 1,
      durationMs: 2400,
      timedOut: false,
      truncated: true,
      finished: true,
    })).toBe("exit 1 · 2.4s · output truncated")
  })

  it("reports a timeout instead of an exit code it never got", () => {
    expect(describeSandboxCommandRun({
      toolCallId: "1",
      command: "sleep 999",
      stdout: "",
      stderr: "",
      durationMs: 120_000,
      timedOut: true,
      truncated: false,
      finished: true,
    })).toBe("timed out · 120.0s")
  })
})
