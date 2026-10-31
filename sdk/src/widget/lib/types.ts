export type { AttachmentKind, DraftAttachment } from "../../lib/drafts.ts"

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

/** Mount attachment options with every default filled in, as the composer reads them. */
export interface ResolvedAttachmentOptions {
  enabled: boolean
  maxFiles: number
  maxFileBytes: number
  maxTotalBytes: number
  /** MIME types or `type/*` patterns the host allows; empty means everything supported. */
  accept: readonly string[]
}
