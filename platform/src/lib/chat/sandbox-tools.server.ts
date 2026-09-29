import { type AnyServerTool, toolDefinition } from "@tanstack/ai"
import { resolveHarnessCwd, type SandboxHandle } from "@tanstack/ai-sandbox"
import { Clock, type Context, Effect, Result, Schema } from "effect"

import { NonEmptyStringSchema } from "@/lib/schemas"
import { artifactContentDigest, detectSandboxArtifactMimeType } from "./artifacts.server"
import {
  CHAT_SANDBOX_COMMAND_TIMEOUT_MS,
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_MAX_ARTIFACT_BYTES,
  CHAT_SANDBOX_MAX_FILE_CHARACTERS,
  CHAT_SANDBOX_MAX_LISTED_ENTRIES,
  CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS,
  CHAT_SANDBOX_MAX_PATH_LENGTH,
  CHAT_SANDBOX_MAX_WRITE_CHARACTERS,
  CHAT_SANDBOX_STATUS_EVENT,
} from "./constants.server"
import { ChatSandboxOperationFailed, type ChatSandboxUnavailable } from "./errors.ts"
import { chatSandboxCall, type ChatSandboxSession, logChatSandboxFailure } from "./sandbox.server"
import { resolveSandboxPath } from "./sandbox-paths.server"
import type { ChatSandboxStatus } from "./types"

/**
 * The sandbox tools an agent with a configured provider gets. Unlike every other tool the endpoint
 * declares, these execute here rather than in the host page.
 *
 * A refused path, a non-zero exit code, and a timed-out command all come back as ordinary results
 * the agent can act on; only a broken sandbox fails, because a failed tool tells the agent
 * nothing except that something went wrong.
 */

const sandboxPath = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isMaxLength(CHAT_SANDBOX_MAX_PATH_LENGTH)),
)

// Each input goes through both conversions: `toStandardSchemaV1` gives TanStack the validator it
// runs before `execute`, and `toStandardJSONSchemaV1` the JSON Schema it declares to the model.
const WriteSandboxFileInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      path: sandboxPath.annotate({
        description: "File to create or replace, relative to the workspace or absolute inside it.",
      }),
      content: Schema.String.annotate({
        description: "The complete new contents of the file, replacing anything already there.",
      }),
    }),
  ),
)

const ReadSandboxFileInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      path: sandboxPath.annotate({ description: "File to read, inside the workspace." }),
    }),
  ),
)

const ListSandboxFilesInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      path: Schema.optionalKey(
        sandboxPath.annotate({ description: "Directory to list. Defaults to the workspace root." }),
      ),
    }),
  ),
)

const PublishSandboxArtifactInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      path: sandboxPath.annotate({
        description: "File to share with the user, inside the workspace.",
      }),
    }),
  ),
)

const RunSandboxCommandInputSchema = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(
    Schema.Struct({
      command: NonEmptyStringSchema.annotate({
        description:
          "Shell command to run. It goes through the sandbox's shell, so pipes and redirection work.",
      }),
      cwd: Schema.optionalKey(
        sandboxPath.annotate({
          description: "Working directory for the command. Defaults to the workspace root.",
        }),
      ),
    }),
  ),
)

/** What the sandbox tools need from TanStack's tool execution context, which is itself optional. */
interface SandboxToolContext {
  emitCustomEvent: (name: string, value: ChatSandboxStatus) => void
  abortSignal?: AbortSignal | undefined
}

type SandboxToolEffect<A> = Effect.Effect<A, ChatSandboxUnavailable | ChatSandboxOperationFailed>

export function createChatSandboxTools(input: {
  readonly session: ChatSandboxSession
  /** The run's services, which each tool's Effect runs with. */
  readonly services: Context.Context<never>
}): AnyServerTool[] {
  const { session } = input
  const runPromise = Effect.runPromiseWith(input.services)

  /**
   * The adapter TanStack awaits: the run's abort signal interrupts the Effect, and a failure
   * reaches the agent only as its fixed message, with the vendor's reason in the log.
   */
  const runSandboxTool = <A>(
    tool: string,
    context: SandboxToolContext | undefined,
    effect: (handle: SandboxHandle) => SandboxToolEffect<A>,
  ) =>
    runPromise(
      session
        // The execution context is optional upstream, so the status event is best effort.
        .acquire((status) =>
          Effect.sync(() => context?.emitCustomEvent(CHAT_SANDBOX_STATUS_EVENT, status)),
        )
        .pipe(
          Effect.flatMap(effect),
          Effect.catchDefect((cause) =>
            Effect.fail(new ChatSandboxOperationFailed({ timedOut: false, cause })),
          ),
          Effect.tapErrorTag("ChatSandboxOperationFailed", (error) =>
            logChatSandboxFailure(tool, error),
          ),
        ),
      { signal: context?.abortSignal },
    )

  const writeSandboxFile = toolDefinition({
    name: "sandbox_write_file",
    description:
      "Create or replace a file in the sandbox. Missing parent directories are created. Write " +
      "the whole file: there is no partial edit.",
    inputSchema: WriteSandboxFileInputSchema,
  }).server<SandboxToolContext>(({ path, content }, context) => {
    if (content.length > CHAT_SANDBOX_MAX_WRITE_CHARACTERS) {
      return {
        refusal:
          `A single write is limited to ${CHAT_SANDBOX_MAX_WRITE_CHARACTERS} characters. ` +
          "Write the file in pieces and join them with a command.",
      }
    }
    return runSandboxTool("sandbox_write_file", context, (handle) =>
      Effect.gen(function* () {
        const resolved = resolveSandboxPath(resolveHarnessCwd(handle), path)
        if ("refusal" in resolved) return resolved
        const directory = resolved.path.slice(0, resolved.path.lastIndexOf("/"))
        // `mkdir -p` through exec rather than `fs.mkdir`, which no provider promises is recursive.
        if (directory.length > 0) {
          const created = yield* chatSandboxCall(
            (signal) =>
              handle.process.exec(`mkdir -p ${quoteSandboxArgument(directory)}`, { signal }),
            CHAT_SANDBOX_FILE_TIMEOUT_MS,
          )
          if (created.exitCode !== 0) {
            const stderr = clampSandboxText(created.stderr, CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS)
            return { refusal: `The directory ${directory} could not be created: ${stderr.text}` }
          }
        }
        yield* chatSandboxCall(
          () => handle.fs.write(resolved.path, content),
          CHAT_SANDBOX_FILE_TIMEOUT_MS,
        )
        return {
          path: resolved.path,
          relativePath: resolved.relativePath,
          characters: content.length,
          lines: content.length === 0 ? 0 : content.split("\n").length,
        }
      }),
    )
  })

  const readSandboxFile = toolDefinition({
    name: "sandbox_read_file",
    description: "Read a file from the sandbox. A long file comes back truncated in the middle.",
    inputSchema: ReadSandboxFileInputSchema,
  }).server<SandboxToolContext>(({ path }, context) =>
    runSandboxTool("sandbox_read_file", context, (handle) =>
      Effect.gen(function* () {
        const resolved = resolveSandboxPath(resolveHarnessCwd(handle), path)
        if ("refusal" in resolved) return resolved
        const content = yield* chatSandboxCall(
          () => handle.fs.read(resolved.path),
          CHAT_SANDBOX_FILE_TIMEOUT_MS,
        )
        const clamped = clampSandboxText(content, CHAT_SANDBOX_MAX_FILE_CHARACTERS)
        return {
          path: resolved.path,
          relativePath: resolved.relativePath,
          content: clamped.text,
          truncated: clamped.truncated,
        }
      }),
    ),
  )

  const listSandboxFiles = toolDefinition({
    name: "sandbox_list_files",
    description: "List the files and directories directly inside a sandbox directory.",
    inputSchema: ListSandboxFilesInputSchema,
  }).server<SandboxToolContext>(({ path }, context) =>
    runSandboxTool("sandbox_list_files", context, (handle) =>
      Effect.gen(function* () {
        const root = resolveHarnessCwd(handle)
        const resolved = resolveSandboxPath(root, path ?? root)
        if ("refusal" in resolved) return resolved
        const entries = yield* chatSandboxCall(
          () => handle.fs.list(resolved.path),
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
      }),
    ),
  )

  const runSandboxCommand = toolDefinition({
    name: "sandbox_run_command",
    description:
      "Run a shell command in the sandbox and read its output. A non-zero exit code comes back " +
      "as a result rather than an error, so check `exitCode` before trusting the output.",
    inputSchema: RunSandboxCommandInputSchema,
  }).server<SandboxToolContext>(({ command, cwd }, context) =>
    runSandboxTool("sandbox_run_command", context, (handle) =>
      Effect.gen(function* () {
        const root = resolveHarnessCwd(handle)
        const resolved = resolveSandboxPath(root, cwd ?? root)
        if ("refusal" in resolved) return resolved
        const startedAt = yield* Clock.currentTimeMillis
        // The timeout interrupts the call, aborting the vendor's command through its signal, so
        // a hung command reports a timeout to the agent instead of holding the run open.
        const outcome = yield* Effect.result(
          chatSandboxCall(
            (signal) => handle.process.exec(command, { cwd: resolved.path, signal }),
            CHAT_SANDBOX_COMMAND_TIMEOUT_MS,
          ),
        )
        const durationMs = (yield* Clock.currentTimeMillis) - startedAt
        if (Result.isFailure(outcome) && outcome.failure.timedOut) {
          return { command, cwd: resolved.path, timedOut: true, durationMs }
        }
        // A command that cannot launch is the agent's problem to fix, not a broken run.
        if (Result.isFailure(outcome)) yield* logChatSandboxFailure("run_command", outcome.failure)
        const result = Result.getOrElse(outcome, () => ({
          stdout: "",
          stderr: "The command could not be run.",
          exitCode: -1,
        }))
        const stdout = clampSandboxText(result.stdout, CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS)
        const stderr = clampSandboxText(result.stderr, CHAT_SANDBOX_MAX_OUTPUT_CHARACTERS)
        return {
          command,
          cwd: resolved.path,
          exitCode: result.exitCode,
          stdout: stdout.text,
          stderr: stderr.text,
          truncated: stdout.truncated || stderr.truncated,
          durationMs,
        }
      }),
    ),
  )

  const publishSandboxArtifact = toolDefinition({
    name: "sandbox_publish_artifact",
    description:
      "Share a file from the sandbox with the user. They get a download, and an image (PNG, " +
      "JPEG, GIF, WebP) also renders inline in the conversation. Publish anything you generated " +
      "for the user instead of describing it.",
    inputSchema: PublishSandboxArtifactInputSchema,
  }).server<SandboxToolContext>(({ path }, context) =>
    runSandboxTool("sandbox_publish_artifact", context, (handle) =>
      Effect.gen(function* () {
        const resolved = resolveSandboxPath(resolveHarnessCwd(handle), path)
        if ("refusal" in resolved) return resolved
        const read = yield* Effect.result(
          chatSandboxCall(() => handle.fs.readBytes(resolved.path), CHAT_SANDBOX_FILE_TIMEOUT_MS),
        )
        // The agent only learns the path did not work; the reason goes to the log.
        if (Result.isFailure(read)) {
          yield* logChatSandboxFailure("publish_artifact", read.failure)
          return { refusal: "The file could not be read. Check the path with sandbox_list_files." }
        }
        const bytes = read.success
        if (bytes.byteLength > CHAT_SANDBOX_MAX_ARTIFACT_BYTES) {
          return {
            refusal: `Artifacts are limited to ${CHAT_SANDBOX_MAX_ARTIFACT_BYTES} bytes. Compress or split the file.`,
          }
        }
        // Sniffed from content, never from the extension, so a renamed file cannot change how
        // the download route will serve it.
        const mimeType = detectSandboxArtifactMimeType(bytes)
        const ticket = yield* session.mintArtifactTicket({
          providerSandboxId: handle.id,
          path: resolved.path,
          mimeType,
          size: bytes.byteLength,
          sha256: yield* artifactContentDigest(bytes),
        })
        return {
          path: resolved.path,
          relativePath: resolved.relativePath,
          mimeType,
          size: bytes.byteLength,
          ticket,
        }
      }),
    ),
  )

  return [
    writeSandboxFile,
    readSandboxFile,
    listSandboxFiles,
    runSandboxCommand,
    publishSandboxArtifact,
  ]
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
