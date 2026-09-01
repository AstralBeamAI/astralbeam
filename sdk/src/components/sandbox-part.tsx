import {
  FileMagnifyingGlassIcon,
  FileTextIcon,
  FolderIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import type { MessagePart } from "@tanstack/ai-client"
import type { ReactNode } from "react"
import { Spinner } from "@/components/ui/spinner"
import {
  SANDBOX_LIST_FILES_TOOL,
  SANDBOX_READ_FILE_TOOL,
  SANDBOX_RUN_COMMAND_TOOL,
  SANDBOX_WRITE_FILE_TOOL,
} from "../lib/constants.ts"
import {
  describeSandboxCommandRun,
  readSandboxCommandRun,
  readSandboxFileWrite,
  sandboxPathLabel,
  sandboxRefusal,
} from "../lib/sandbox.ts"
import { formatToolJson, isSettledToolCall } from "../lib/utils.ts"
import { SandboxCodeBlock } from "./sandbox-code.tsx"
import { SandboxCommandLog } from "./sandbox-command-log.tsx"
import { ToolDisclosure } from "./tool-disclosure.tsx"

type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>

/**
 * A sandbox tool call in the transcript. These are the endpoint's own server-side tools, so unlike
 * a host tool the widget knows exactly what their input and output mean and can show the file it
 * wrote as a file and the command it ran as a terminal, instead of both as pretty-printed JSON.
 */
export function SandboxPart({ part }: { part: ToolCallPart }) {
  const failed = part.state === "error"
  const refusal = sandboxRefusal(part)
  const running = !failed && !isSettledToolCall(part)
  const icon = failed
    ? <WarningCircleIcon />
    : running
    ? <Spinner />
    : SANDBOX_ICONS[part.name] ?? <TerminalWindowIcon />
  const detail = refusal !== undefined || failed
    ? (
      <span className="block text-muted-foreground">
        {refusal ?? readSandboxToolError(part) ?? "The sandbox step did not finish."}
      </span>
    )
    : undefined

  const command = readSandboxCommandRun(part)
  if (command) {
    return (
      <ToolDisclosure
        icon={icon}
        running={running}
        label={
          <>
            {running ? "Running" : "Ran"} <Code>{command.command}</Code>
            {command.finished && refusal === undefined && !failed && (
              <span className="text-muted-foreground">
                {" · "}
                {describeSandboxCommandRun(command)}
              </span>
            )}
          </>
        }
        detail={detail}
      >
        <SandboxPanel>
          <SandboxCommandLog run={command} />
        </SandboxPanel>
      </ToolDisclosure>
    )
  }

  const write = readSandboxFileWrite(part)
  if (write) {
    return (
      <ToolDisclosure
        icon={icon}
        running={running}
        label={
          <>
            {running ? "Writing" : failed || refusal !== undefined ? "Could not write" : "Wrote"}
            {" "}
            <Code>{write.label}</Code>
            {write.written && (
              <span className="text-muted-foreground">
                {" · "}
                {write.lines === 1 ? "1 line" : `${write.lines} lines`}
              </span>
            )}
          </>
        }
        detail={detail}
      >
        <SandboxPanel>
          <SandboxCodeBlock
            emptyLabel="Empty file"
            caption={write.label === write.path ? undefined : write.path}
          >
            {write.content}
          </SandboxCodeBlock>
        </SandboxPanel>
      </ToolDisclosure>
    )
  }

  // The remaining two tools are reads, so the useful body is their output rather than their input.
  const path = sandboxPathLabel(part)
  return (
    <ToolDisclosure
      icon={icon}
      running={running}
      label={
        <>
          {readSandboxVerb(part.name, running)} {path ? <Code>{path}</Code> : "the sandbox"}
        </>
      }
      detail={detail}
    >
      <SandboxPanel>
        <SandboxCodeBlock emptyLabel="Waiting for the result…">
          {readSandboxOutputText(part)}
        </SandboxCodeBlock>
      </SandboxPanel>
    </ToolDisclosure>
  )
}

const SANDBOX_ICONS: Record<string, ReactNode> = {
  [SANDBOX_WRITE_FILE_TOOL]: <FileTextIcon />,
  [SANDBOX_READ_FILE_TOOL]: <FileMagnifyingGlassIcon />,
  [SANDBOX_LIST_FILES_TOOL]: <FolderIcon />,
  [SANDBOX_RUN_COMMAND_TOOL]: <TerminalWindowIcon />,
}

function Code({ children }: { children: string }) {
  return <span className="font-mono wrap-anywhere">{children}</span>
}

/** Indents the panel body under the row and keeps every sandbox disclosure the same width. */
function SandboxPanel({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex min-w-0 flex-col">{children}</div>
}

function readSandboxVerb(name: string, running: boolean): string {
  if (name === SANDBOX_LIST_FILES_TOOL) return running ? "Listing" : "Listed"
  return running ? "Reading" : "Read"
}

/** A thrown sandbox tool stores its message as `{ error }`, the same shape a client failure uses. */
function readSandboxToolError(part: ToolCallPart): string | undefined {
  const error = (part.output as { error?: unknown } | null | undefined)?.error
  return typeof error === "string" && error.length > 0 ? error : undefined
}

/**
 * The body of a read or a listing. A file read shows its contents; a listing shows one entry per
 * line with directories marked, which is far easier to scan than the JSON array behind it.
 */
function readSandboxOutputText(part: ToolCallPart): string {
  const output = part.output as
    | { content?: unknown; entries?: unknown }
    | null
    | undefined
  if (output == null) return ""
  if (typeof output.content === "string") return output.content
  if (Array.isArray(output.entries)) {
    if (output.entries.length === 0) return "(empty directory)"
    return output.entries.map((entry) => {
      const { name, type } = entry as { name?: unknown; type?: unknown }
      const label = typeof name === "string" ? name : formatToolJson(entry)
      return type === "dir" ? `${label}/` : label
    }).join("\n")
  }
  return formatToolJson(output)
}
