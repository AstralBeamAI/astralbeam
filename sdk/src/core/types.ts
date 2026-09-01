// Data shapes of the AstralBeam chat protocol, read back out of the transcript; shared by the
// styled widget and the headless core.

export interface RenderWidgetInput {
  /** Key into the `widgets` object passed at mount. */
  widget: string
  props?: Record<string, unknown>
}

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

/** One file the agent published for the user, with the ticket its download is authorized by. */
export interface SandboxArtifact {
  toolCallId: string
  path: string
  label: string
  mimeType: string | undefined
  size: number | undefined
  /** Capability the files endpoint accepts in its query; the whole download authorization. */
  ticket: string | undefined
  published: boolean
}

/** Everything the sandbox did in this conversation, derived from the transcript. */
export interface SandboxActivity {
  /** Latest write per path, in the order the paths were first written. */
  files: SandboxFileWrite[]
  commands: SandboxCommandRun[]
}
