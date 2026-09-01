// Chat-chunk-internal types; the client entry's public types live in client-types.ts.

export interface RenderWidgetInput {
  /** Key into the `widgets` object passed at mount. */
  widget: string
  props?: Record<string, unknown>
}

interface QuestionnaireChoiceSpec {
  value: string
  label: string
  description?: string
}

export interface QuestionnaireItemSpec {
  name: string
  title: string
  description?: string
  required?: boolean
  multiple?: boolean
  choices: QuestionnaireChoiceSpec[]
  input?: { label: string; placeholder: string }
}

/** One submitted questionnaire answer, part of the tool output the agent sees. */
export interface QuestionnaireAnswer {
  name: string
  question: string
  answers: string[]
}

/** How an attachment reaches the agent: natively as an image or PDF, or read as text. */
export type AttachmentKind = "image" | "pdf" | "text"

/** Sandbox provisioning progress, as the endpoint's CUSTOM status event reports it. */
export type SandboxStatus = "starting" | "ready" | "error"

/** One file the agent wrote into the sandbox, read back out of its own tool call. */
export interface SandboxFileWrite {
  toolCallId: string
  /** Absolute path in the sandbox, which is also what one file is identified by. */
  path: string
  /** The same path as a row should show it: workspace-relative when the endpoint said so. */
  label: string
  content: string
  lines: number
  /** False while the content is still streaming, or if the write was refused. */
  written: boolean
}

/** One command the agent ran in the sandbox, with whatever of its result has arrived. */
export interface SandboxCommandRun {
  toolCallId: string
  command: string
  cwd?: string | undefined
  /** Absent while the command is still running, and when it timed out. */
  exitCode?: number | undefined
  /** Combined output on providers whose blocking exec has no separate stderr channel. */
  stdout: string
  stderr: string
  durationMs?: number | undefined
  timedOut: boolean
  /** The endpoint elided the middle of the output to keep the run bounded. */
  truncated: boolean
  finished: boolean
}

/** Everything the sandbox did in this conversation, derived from the transcript. */
export interface SandboxActivity {
  /** Latest write per path, in the order the paths were first written. */
  files: SandboxFileWrite[]
  commands: SandboxCommandRun[]
}

/** Mount attachment options with every default filled in, as the composer reads them. */
export interface ResolvedAttachmentOptions {
  enabled: boolean
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  /** MIME types or `type/*` patterns the host allows; empty means everything supported. */
  accept: readonly string[]
}

/**
 * One file the user picked, before it is sent. A rejected file is kept as a `status: "error"`
 * entry so the composer can say why instead of dropping it silently, and carries no `kind`.
 */
export interface DraftAttachment {
  id: string
  name: string
  /** Size in bytes as reported by the file, used for the label and the caps. */
  size: number
  mimeType: string
  kind?: AttachmentKind
  status: "reading" | "ready" | "error"
  /** Base64 payload without the data-URI prefix; present once the status is `"ready"`. */
  data?: string
  /** Why the file was rejected or could not be read; present when the status is `"error"`. */
  error?: string
}
