import type { AttachmentTable } from "./profile.ts"

/** How an attachment reaches the model: the provider reads an `image` or a `pdf` itself, and the
 * agent reads anything else with `read_attachment` or in the sandbox. */
export type ChatAttachmentKind = "image" | "pdf" | "text" | "data" | "office"

/** What became of one attachment on a run, for the debug log. */
export interface ChatAttachmentOutcome {
  filename: string
  mimeType: string
  /** Decoded size, zero for a refused attachment, which is never decoded. */
  bytes: number
  result: ChatAttachmentKind | "rejected"
  /** The name the agent reads the file by, absent for a native or refused attachment. */
  handle?: string
  reason?: string
}

/**
 * What reading a file yields, and the one place that shape is declared: the readers produce it,
 * {@link ChatAttachmentFile} carries it, and `read_attachment` reports it beside the page of text.
 */
export interface ChatAttachmentContent {
  /** The text view of the file, absent when it has none, such as a Parquet file. */
  text?: string
  /** {@link text} stops short of the whole file. */
  truncated?: true
  /** Tables the file holds: one for a delimited file, one per sheet for a workbook. */
  tables?: AttachmentTable[]
  /** Countable divisions the agent can cite, such as a deck's slides. */
  sections?: { label: string; count: number }
}

/**
 * One attached file the run carries. The bytes are decoded once, here, and serve both reads: the
 * `read_attachment` tool pages through `text`, and the sandbox writes `bytes` to `sandboxPath`.
 */
export interface ChatAttachmentFile extends ChatAttachmentContent {
  /** Unique within the run, and the basename of {@link sandboxPath}. */
  readonly handle: string
  readonly filename: string
  readonly mimeType: string
  readonly bytes: Uint8Array
  /** Where the file is written in the sandbox, absent when the agent has no sandbox. */
  readonly sandboxPath?: string
}
