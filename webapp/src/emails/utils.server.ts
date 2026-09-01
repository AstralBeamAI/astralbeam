import { Buffer } from "node:buffer"
import { Schema } from "effect"
import type { SendMailOptions } from "nodemailer"
import type { EmailAttachment, SendEmailOptions } from "./index.ts"
import { renderEmailElement, renderEmailPlainText } from "./render.server.ts"
import { EmailProviderSchema } from "./schema.ts"
import type { EmailProvider } from "./schema.ts"

/** An attachment resolved to bytes, so every provider receives the same shape. */
export interface ResolvedEmailAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

/** The normalized, fully rendered payload every provider sender receives. */
export interface ProviderEmailInput {
  to: string[]
  from: string
  subject: string
  html: string
  text?: string | undefined
  replyTo: string[]
  attachments: ResolvedEmailAttachment[]
}

export type SendProviderEmail = (
  input: ProviderEmailInput,
) => Promise<{ messageId?: string | undefined }>

/**
 * Static map of dynamic imports: the selected provider's SDK is the only one ever loaded, while
 * the literal specifiers stay statically analyzable for bundling and unused-file detection. It
 * doubles as the set of provider names `resolveProvider` accepts.
 */
export const providerLoaders: Record<
  EmailProvider,
  () => Promise<SendProviderEmail>
> = {
  smtp: async () => (await import("./providers/smtp.ts")).sendSmtpEmail,
  resend: async () => (await import("./providers/resend.ts")).sendResendEmail,
  ses: async () => (await import("./providers/ses.ts")).sendSesEmail,
}

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  html: "text/html",
  ics: "text/calendar",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  zip: "application/zip",
}

export function resolveProvider(
  provider: SendEmailOptions["provider"],
  defaultProvider: string | null,
): EmailProvider {
  const resolved = provider ?? defaultProvider ?? "smtp"
  return Schema.decodeUnknownSync(EmailProviderSchema)(resolved)
}

export function resolveDefaultFrom(
  provider: EmailProvider,
  configuredFrom: string | null,
  appBaseUrl: string | null,
): string | null {
  if (configuredFrom || provider !== "smtp") return configuredFrom
  return appBaseUrl ? `no-reply@${new URL(appBaseUrl).hostname}` : null
}

export function nodemailerMessage(input: ProviderEmailInput): SendMailOptions {
  return {
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...input.text ? { text: input.text } : {},
    replyTo: input.replyTo,
    attachments: input.attachments.map(({ filename, contentType, content }) => ({
      filename,
      contentType,
      content: Buffer.from(content),
    })),
  }
}

export async function buildProviderEmailInput(
  options: SendEmailOptions,
  defaultFrom: string | null,
): Promise<ProviderEmailInput> {
  const { react } = options
  const rendered = !options.html && react ? await renderEmailElement(react) : undefined
  const html = options.html ?? rendered?.html
  if (!html) {
    throw new Error("An email needs either a 'react' template or 'html' content")
  }

  const from = options.from ?? defaultFrom
  if (!from) {
    throw new Error("No 'from' address given and no default from address is configured")
  }

  const text = options.text ?? (react ? rendered?.text ?? renderEmailPlainText(html) : undefined)
  const replyTo = toArray(options.replyTo)

  return {
    to: toArray(options.to),
    from,
    subject: options.subject,
    html,
    ...text ? { text } : {},
    replyTo: replyTo.length > 0 ? replyTo : [from],
    attachments: await Promise.all((options.attachments ?? []).map(resolveAttachment)),
  }
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Attachments are resolved to bytes here rather than per provider, because SES has to build its own
 * MIME parts and cannot fetch a remote attachment the way Resend can.
 */
async function resolveAttachment(attachment: EmailAttachment): Promise<ResolvedEmailAttachment> {
  const { filename, path } = attachment
  const resolved = /^https?:\/\//i.test(path) ? await fetchAttachment(path) : decodeBase64(path)
  return {
    filename,
    contentType: resolved.contentType ?? guessContentType(filename),
    content: resolved.content,
  }
}

interface ResolvedAttachmentContent {
  content: Uint8Array
  /** Media type reported by the source, when it reports one. */
  contentType?: string | undefined
}

async function fetchAttachment(url: string): Promise<ResolvedAttachmentContent> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch email attachment '${url}': ${response.status}`)
  }
  return {
    content: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || undefined,
  }
}

/** Accepts either a bare base64 payload or a full `data:` URI. */
function decodeBase64(path: string): ResolvedAttachmentContent {
  const dataUri = /^data:([^;,]*)(?:;[^;,]*)*,/i.exec(path)
  const base64 = dataUri ? path.slice(dataUri[0].length) : path
  return {
    content: new Uint8Array(Buffer.from(base64, "base64")),
    contentType: dataUri?.[1] || undefined,
  }
}

function guessContentType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? ""
  return CONTENT_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream"
}

/**
 * Renders a recipient for a server log: the domain stays readable so an operator can spot a
 * provider or domain-specific outage, while the local part is reduced to a fixed-width mask that
 * leaks neither its characters nor its length.
 */
export function maskEmailAddressForLog(value: string): string {
  const separator = value.lastIndexOf("@")
  if (separator < 1) return "***"
  const local = value.slice(0, separator)
  const domain = value.slice(separator + 1)
  const masked = local.length >= 4 ? `${local[0]}***${local.at(-1)}` : `${local[0]}***`
  return `${masked}@${domain}`
}
