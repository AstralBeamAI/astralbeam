import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import {
  SANDBOX_LIST_FILES_TOOL,
  SANDBOX_READ_FILE_TOOL,
  SANDBOX_RUN_COMMAND_TOOL,
  SANDBOX_WRITE_FILE_TOOL,
} from "./constants.ts"
import type {
  SandboxActivity,
  SandboxCommandRun,
  SandboxFileWrite,
  SandboxStatus,
} from "./types.ts"

/**
 * Everything the widget knows about the sandbox is read back out of the transcript: a
 * `sandbox_write_file` call carries the file in its own input, a `sandbox_run_command` call the log
 * in its output. One source of truth, so a reset clears it and a re-render cannot double-count.
 * Tool input is partially parsed JSON while it streams, so every field is checked before it is read.
 */

type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>

const SANDBOX_TOOLS: readonly string[] = [
  SANDBOX_WRITE_FILE_TOOL,
  SANDBOX_READ_FILE_TOOL,
  SANDBOX_LIST_FILES_TOOL,
  SANDBOX_RUN_COMMAND_TOOL,
]

export function isSandboxTool(name: string): boolean {
  return SANDBOX_TOOLS.includes(name)
}

function field(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null && key in source
    ? (source as Record<string, unknown>)[key]
    : undefined
}

function text(source: unknown, key: string): string | undefined {
  const value = field(source, key)
  return typeof value === "string" ? value : undefined
}

function count(source: unknown, key: string): number | undefined {
  const value = field(source, key)
  return typeof value === "number" ? value : undefined
}

/** The agent asked for something the endpoint would not do; its reason is the only useful output. */
export function sandboxRefusal(part: ToolCallPart): string | undefined {
  return text(part.output, "refusal")
}

/** A `sandbox_write_file` call, readable while its content is still streaming in. */
export function readSandboxFileWrite(part: ToolCallPart): SandboxFileWrite | undefined {
  if (part.name !== SANDBOX_WRITE_FILE_TOOL) return undefined
  // The result's path is the one the sandbox actually used; the agent may have asked for a
  // relative or virtual path, and two spellings of one file must not read as two files.
  const path = text(part.output, "path") ?? text(part.input, "path")
  if (path === undefined) return undefined
  const content = text(part.input, "content") ?? ""
  return {
    toolCallId: part.id,
    path,
    label: sandboxPathLabel(part) ?? path,
    content,
    lines: content.length === 0 ? 0 : content.split("\n").length,
    written: part.output != null && sandboxRefusal(part) === undefined,
  }
}

/**
 * The path to put in a row's label. A real absolute path wraps over two lines in a sidebar, so the
 * endpoint reports the workspace-relative form beside it and that is what gets shown.
 */
export function sandboxPathLabel(part: ToolCallPart): string | undefined {
  const relative = text(part.output, "relativePath")
  if (relative !== undefined && relative !== ".") return relative
  return text(part.output, "path") ?? text(part.input, "path")
}

/** A `sandbox_run_command` call. `stdout` holds combined output on providers with no stderr. */
export function readSandboxCommandRun(part: ToolCallPart): SandboxCommandRun | undefined {
  if (part.name !== SANDBOX_RUN_COMMAND_TOOL) return undefined
  const command = text(part.input, "command")
  if (command === undefined) return undefined
  const output = part.output
  return {
    toolCallId: part.id,
    command,
    cwd: text(part.input, "cwd"),
    exitCode: count(output, "exitCode"),
    stdout: text(output, "stdout") ?? "",
    stderr: text(output, "stderr") ?? "",
    durationMs: count(output, "durationMs"),
    timedOut: field(output, "timedOut") === true,
    truncated: field(output, "truncated") === true,
    finished: output != null,
  }
}

/**
 * The whole conversation's sandbox work, for the panel. A path written more than once appears
 * once, holding its latest content, because the panel answers "what is in the sandbox now".
 */
export function collectSandboxActivity(messages: UIMessage[]): SandboxActivity {
  const files = new Map<string, SandboxFileWrite>()
  const commands: SandboxCommandRun[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-call") continue
      const write = readSandboxFileWrite(part)
      // A refused or still-streaming write is not in the sandbox, so it is not in the file list.
      if (write?.written) files.set(write.path, write)
      const run = readSandboxCommandRun(part)
      if (run && sandboxRefusal(part) === undefined) commands.push(run)
    }
  }
  return { files: [...files.values()], commands }
}

/** The one-line summary a finished command carries, in its row's label and under its log. */
export function describeSandboxCommandRun(run: SandboxCommandRun): string {
  const parts: string[] = []
  if (run.timedOut) parts.push("timed out")
  else if (run.exitCode !== undefined) parts.push(`exit ${run.exitCode}`)
  if (run.durationMs !== undefined) {
    parts.push(
      run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`,
    )
  }
  if (run.truncated) parts.push("output truncated")
  return parts.join(" · ")
}

/** Nothing to disclose until the sandbox has done something or is on its way to doing it. */
export function hasSandboxActivity(
  activity: SandboxActivity,
  status: SandboxStatus | undefined,
): boolean {
  return activity.files.length > 0 || activity.commands.length > 0 || status === "starting" ||
    status === "error"
}
