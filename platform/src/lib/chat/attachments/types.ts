/** Images and PDFs remain native model inputs. Their original bytes are also available to an
 * enabled sandbox, alongside the other supported files. */
export type ChatAttachmentKind = "image" | "pdf" | "text" | "data" | "office"

/** What became of one attachment on a run, for the debug log. */
export interface ChatAttachmentOutcome {
  filename: string
  mimeType: string
  /** Decoded size, zero for a refused attachment, which is never decoded. */
  bytes: number
  result: ChatAttachmentKind | "rejected"
  /** The name the agent reads the file by, absent for a native-only or refused attachment. */
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

/** Compacted files keep their handles without reading original bytes until a tool needs them. */
export type ChatAttachmentSource =
  | ChatAttachmentFile
  | (Pick<ChatAttachmentFile, "handle" | "filename" | "mimeType"> & {
      readonly bytes?: never
      readonly text?: never
      readonly load: (signal?: AbortSignal) => Promise<ChatAttachmentFile>
    })
