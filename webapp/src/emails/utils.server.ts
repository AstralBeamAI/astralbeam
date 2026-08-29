import { Buffer } from "node:buffer"
import type {
  EmailAttachment,
  EmailProvider,
  ProviderEmailInput,
  ResolvedEmailAttachment,
  SendEmailOptions,
  SendProviderEmail,
} from "./types.ts"
import { renderEmailElement, renderEmailPlainText } from "./render.server.ts"

/**
 * Static map of dynamic imports: the selected provider's SDK is the only one ever loaded, while
 * the literal specifiers stay statically analyzable for bundling and unused-file detection. It
 * doubles as the set of provider names `resolveProvider` accepts.
 */
export const providerLoaders: Record<
  EmailProvider,
  () => Promise<SendProviderEmail>
> = {
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
  const resolved = provider ?? defaultProvider
  if (!resolved) {
    throw new Error("No email provider given and no default email provider is configured")
  }
  if (!(resolved in providerLoaders)) {
    throw new Error(`Unknown email provider '${resolved}'`)
  }
  return resolved as EmailProvider
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
  const dataUri = /^data:([^;,]*)?(?:;[^,]*)*,/i.exec(path)
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
