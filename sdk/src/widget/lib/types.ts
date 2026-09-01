// Chat-chunk-internal types; the client entry's public types live in src/lib/types.ts and the
// protocol data shapes in src/core/types.ts.

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
