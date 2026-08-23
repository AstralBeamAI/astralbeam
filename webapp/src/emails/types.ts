import type { ReactElement } from "react"

/** Providers `sendEmail` can dispatch to; each maps to one `src/emails/providers` module. */
export type EmailProvider = "resend" | "ses"

/** An attachment as callers declare it: a name plus its content. */
export interface EmailAttachment {
  filename: string
  /** An HTTP(S) URL to fetch, a `data:` URI, or a bare base64-encoded payload. */
  path: string
}

export interface SendEmailOptions {
  to: string | string[]
  /** Defaults to the `EMAIL_FROM_ADDRESS` environment variable. */
  from?: string | undefined
  subject: string
  /** A react-email template element; rendered to both HTML and plain text. */
  react?: ReactElement | undefined
  /** Pre-rendered HTML, used instead of `react`. */
  html?: string | undefined
  /** Plain-text alternative; derived from `react` when omitted. */
  text?: string | undefined
  /** Defaults to the resolved `from` address. */
  replyTo?: string | string[] | undefined
  attachments?: EmailAttachment[] | undefined
  /** Defaults to the `EMAIL_PROVIDER` environment variable. */
  provider?: EmailProvider | undefined
}

/** An attachment resolved to bytes, so every provider receives the same shape. */
export interface ResolvedEmailAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

/** The normalized, fully rendered payload every `sendProviderEmail` receives. */
export interface ProviderEmailInput {
  to: string[]
  from: string
  subject: string
  html: string
  text?: string | undefined
  replyTo: string[]
  attachments: ResolvedEmailAttachment[]
}

interface ProviderEmailResult {
  /** Provider-assigned message identifier, when the provider returns one. */
  messageId?: string | undefined
}

export type SendProviderEmail = (input: ProviderEmailInput) => Promise<ProviderEmailResult>

export interface SendEmailResult extends ProviderEmailResult {
  provider: EmailProvider
}
