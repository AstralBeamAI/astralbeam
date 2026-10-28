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

/** Original bytes and decoded text for text attachments. */
export interface ChatAttachmentFile {
  readonly text?: string
  /** Unique within the run and used as the basename in the sandbox uploads directory. */
  readonly handle: string
  readonly filename: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}
