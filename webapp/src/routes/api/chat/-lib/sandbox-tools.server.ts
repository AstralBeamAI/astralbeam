import { type AnyServerTool, toolDefinition } from "@tanstack/ai"
import { resolveHarnessCwd } from "@tanstack/ai-sandbox"
import * as Schema from "effect/Schema"

import {
  CHAT_SANDBOX_COMMAND_TIMEOUT_MS,
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_MAX_FILE_CHARACTERS,
  CHAT_SANDBOX_MAX_LISTED_ENTRIES,
  CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS,
  CHAT_SANDBOX_MAX_PATH_LENGTH,
  CHAT_SANDBOX_MAX_WRITE_CHARACTERS,
  CHAT_SANDBOX_ROOT,
  CHAT_SANDBOX_STATUS_EVENT,
} from "./constants.server"
import { acquireChatSandbox, type ChatSandboxSession } from "./sandbox.server"
import type { ChatSandboxStatus, DebugLog } from "./types"

/**
 * The sandbox tools an agent with a configured provider gets. Unlike every other tool the endpoint
 * declares, these execute here rather than in the host page.
 *
 * A refused path, a non-zero exit code, and a timed-out command all come back as ordinary results
 * the agent can act on; only a broken sandbox throws, because a thrown tool error tells the agent
 * nothing except that something failed.
 */

/** A result the agent should read and correct, rather than a broken sandbox. */
interface SandboxRefusal {
  refusal: string
}

/** An absolute path inside the workspace, plus the shorter form a label reads better with. */
interface SandboxResolvedPath {
  path: string
  relativePath: string
}

const SANDBOX_TIMEOUT = Symbol("sandbox-timeout")

const sandboxPath = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(CHAT_SANDBOX_MAX_PATH_LENGTH)),
)

// Each input goes through both conversions: `toStandardSchemaV1` gives TanStack the validator it
// runs before `execute`, and `toStandardJSONSchemaV1` the JSON Schema it declares to the model.
const WriteSandboxFileInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Schema.Struct({
    path: sandboxPath.annotate({
      description: "File to create or replace, relative to the workspace or absolute inside it.",
    }),
    content: Schema.String.annotate({
      description: "The complete new contents of the file, replacing anything already there.",
    }),
  })),
)

const ReadSandboxFileInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Schema.Struct({
    path: sandboxPath.annotate({ description: "File to read, inside the workspace." }),
  })),
)

const ListSandboxFilesInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Schema.Struct({
    path: Schema.optionalKey(
      sandboxPath.annotate({ description: "Directory to list. Defaults to the workspace root." }),
    ),
  })),
)

const RunSandboxCommandInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Schema.Struct({
    command: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({
      description:
        "Shell command to run. It goes through the sandbox's shell, so pipes and redirection work.",
    }),
    cwd: Schema.optionalKey(
      sandboxPath.annotate({
        description: "Working directory for the command. Defaults to the workspace root.",
      }),
    ),
  })),
)

/** What the sandbox tools need from TanStack's tool execution context, which is itself optional. */
interface SandboxToolContext {
  emitCustomEvent: (name: string, value: ChatSandboxStatus) => void
}

export function createChatSandboxTools(
  input: { readonly session: ChatSandboxSession; readonly log?: DebugLog | undefined },
): AnyServerTool[] {
  const { session, log } = input
  /**
   * Every tool starts the sandbox the same way, reporting provisioning progress as it goes. The
   * execution context is optional upstream, so the stream event is best effort while the log line
   * always happens.
   */
  const sandbox = (context?: SandboxToolContext) =>
    acquireChatSandbox(session, (status) => {
      log?.("sandbox", `sandbox ${status.state}`, status)
      context?.emitCustomEvent(CHAT_SANDBOX_STATUS_EVENT, status)
    })

  const writeSandboxFile = toolDefinition({
    name: "sandbox_write_file",
    description:
      "Create or replace a file in the sandbox. Missing parent directories are created. Write " +
      "the whole file: there is no partial edit.",
    inputSchema: WriteSandboxFileInputSchema,
  }).server<SandboxToolContext>(async ({ path, content }, context) => {
    if (content.length > CHAT_SANDBOX_MAX_WRITE_CHARACTERS) {
      return {
        refusal: `A single write is limited to ${CHAT_SANDBOX_MAX_WRITE_CHARACTERS} characters. ` +
          "Write the file in pieces and join them with a command.",
      }
    }
    const handle = await sandbox(context)
    const resolved = resolveSandboxPath(resolveHarnessCwd(handle), path)
    if ("refusal" in resolved) return resolved
    const directory = resolved.path.slice(0, resolved.path.lastIndexOf("/"))
    // `mkdir -p` through exec rather than `fs.mkdir`, which no provider promises is recursive.
    if (directory.length > 0) {
      await handle.process.exec(`mkdir -p ${quoteSandboxArgument(directory)}`)
    }
    await requireSandboxOperation(
      handle.fs.write(resolved.path, content),
      CHAT_SANDBOX_FILE_TIMEOUT_MS,
    )
    log?.("sandbox", `wrote ${resolved.path}`, { characters: content.length })
    return {
      path: resolved.path,
      relativePath: resolved.relativePath,
      characters: content.length,
      lines: content.length === 0 ? 0 : content.split("\n").length,
    }
  })

  const readSandboxFile = toolDefinition({
    name: "sandbox_read_file",
    description: "Read a file from the sandbox. A long file comes back truncated in the middle.",
    inputSchema: ReadSandboxFileInputSchema,
  }).server<SandboxToolContext>(async ({ path }, context) => {
    const handle = await sandbox(context)
    const resolved = resolveSandboxPath(resolveHarnessCwd(handle), path)
    if ("refusal" in resolved) return resolved
    const content = await requireSandboxOperation(
      handle.fs.read(resolved.path),
      CHAT_SANDBOX_FILE_TIMEOUT_MS,
    )
    const clamped = clampSandboxText(content, CHAT_SANDBOX_MAX_FILE_CHARACTERS)
    return {
      path: resolved.path,
      relativePath: resolved.relativePath,
      content: clamped.text,
      truncated: clamped.truncated,
    }
  })

  const listSandboxFiles = toolDefinition({
    name: "sandbox_list_files",
    description: "List the files and directories directly inside a sandbox directory.",
    inputSchema: ListSandboxFilesInputSchema,
  }).server<SandboxToolContext>(async ({ path }, context) => {
    const handle = await sandbox(context)
    const root = resolveHarnessCwd(handle)
    const resolved = resolveSandboxPath(root, path ?? root)
    if ("refusal" in resolved) return resolved
    const entries = await requireSandboxOperation(
      handle.fs.list(resolved.path),
      CHAT_SANDBOX_FILE_TIMEOUT_MS,
    )
    return {
      path: resolved.path,
      relativePath: resolved.relativePath,
      entries: entries.slice(0, CHAT_SANDBOX_MAX_LISTED_ENTRIES).map((entry) => ({
        name: entry.name,
        type: entry.type,
      })),
      truncated: entries.length > CHAT_SANDBOX_MAX_LISTED_ENTRIES,
    }
  })

  const runSandboxCommand = toolDefinition({
    name: "sandbox_run_command",
    description:
      "Run a shell command in the sandbox and read its output. A non-zero exit code comes back " +
      "as a result rather than an error, so check `exitCode` before trusting the output.",
    inputSchema: RunSandboxCommandInputSchema,
  }).server<SandboxToolContext>(async ({ command, cwd }, context) => {
    const handle = await sandbox(context)
    const root = resolveHarnessCwd(handle)
    const resolved = resolveSandboxPath(root, cwd ?? root)
    if ("refusal" in resolved) return resolved
    const startedAt = Date.now()
    // The signal bounds the vendor call; the surrounding race bounds a provider that ignores it,
    // so a hung command reports a timeout to the agent instead of holding the run open.
    const result = await withSandboxTimeout(
      handle.process.exec(command, {
        cwd: resolved.path,
        signal: AbortSignal.timeout(CHAT_SANDBOX_COMMAND_TIMEOUT_MS),
      }).catch((error: unknown) => {
        // A command that cannot launch is the agent's problem to fix, not a broken run. The
        // vendor's own message can carry hostnames or tokens, so only the log sees it.
        console.error("A /api/chat sandbox command failed to run:", error)
        return { stdout: "", stderr: "The command could not be run.", exitCode: -1 }
      }),
      CHAT_SANDBOX_COMMAND_TIMEOUT_MS,
    )
    const durationMs = Date.now() - startedAt
    if (result === SANDBOX_TIMEOUT) {
      log?.("sandbox", `command timed out: ${command}`, { durationMs })
      return { command, cwd: resolved.path, timedOut: true, durationMs }
    }
    const stdout = clampSandboxText(result.stdout, CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS)
    const stderr = clampSandboxText(result.stderr, CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS)
    log?.("sandbox", `ran ${command} (exit ${result.exitCode})`, { durationMs })
    return {
      command,
      cwd: resolved.path,
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      durationMs,
    }
  })

  return [writeSandboxFile, readSandboxFile, listSandboxFiles, runSandboxCommand]
}

/**
 * The absolute path a tool acts on, kept inside the sandbox's workspace.
 *
 * `root` is the provider's REAL workspace directory, from `resolveHarnessCwd`. That matters
 * because the agent writes paths into command strings, where nothing maps them: Daytona's
 * `/workspace` is really `/home/daytona/workspace`, so `python3 /workspace/app.py` would not find
 * the file `sandbox_write_file` just wrote there. Every result therefore reports a real path — and
 * a virtual `/workspace` one is still translated, since the agent may type it anyway.
 *
 * Containment is not the security boundary; the sandbox is. It stops the agent overwriting the
 * image's own files and keeps the widget's file list coherent.
 */
export function resolveSandboxPath(
  root: string,
  path: string,
): SandboxResolvedPath | SandboxRefusal {
  const normalized = normalizeSandboxPath(path.startsWith("/") ? path : `${root}/${path}`)
  const mapped = root !== CHAT_SANDBOX_ROOT && isUnderSandboxRoot(CHAT_SANDBOX_ROOT, normalized)
    ? `${root}${normalized.slice(CHAT_SANDBOX_ROOT.length)}`
    : normalized
  if (!isUnderSandboxRoot(root, mapped)) {
    return {
      refusal: `Only paths inside ${root} can be used here. Reach anything else with a command.`,
    }
  }
  // The relative form is what the widget labels a row with — a real absolute path wraps over two
  // lines in a sidebar — and is also the shorter thing for the agent to type against the default
  // working directory.
  return { path: mapped, relativePath: mapped === root ? "." : mapped.slice(root.length + 1) }
}

/** Resolves `.` and `..` before containment, so a traversal cannot climb out of the root. */
function normalizeSandboxPath(absolute: string): string {
  const segments: string[] = []
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join("/")}`
}

function isUnderSandboxRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
}

/** Elide the middle, not the tail: a failing command's reason is usually its last line. */
export function clampSandboxText(
  text: string,
  maximum: number,
): { text: string; truncated: boolean } {
  if (text.length <= maximum) return { text, truncated: false }
  const half = Math.floor(maximum / 2)
  const omitted = text.length - half * 2
  return {
    text: `${text.slice(0, half)}\n…[${omitted} characters omitted]…\n${text.slice(-half)}`,
    truncated: true,
  }
}

/** Single-quote for POSIX `sh`, which every provider's `exec` runs the command through. */
function quoteSandboxArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function withSandboxTimeout<Value>(
  operation: Promise<Value>,
  ms: number,
): Promise<Value | typeof SANDBOX_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<typeof SANDBOX_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(SANDBOX_TIMEOUT), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** For the filesystem calls, where a timeout means the sandbox itself stopped answering. */
async function requireSandboxOperation<Value>(
  operation: Promise<Value>,
  ms: number,
): Promise<Value> {
  const result = await withSandboxTimeout(operation, ms)
  if (result === SANDBOX_TIMEOUT) throw new Error("The sandbox did not respond in time")
  return result
}
