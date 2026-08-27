import { Buffer } from "node:buffer"
import process from "node:process"
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { getGlobalConfig } from "@/lib/config"
import type { ProviderEmailInput, ResolvedEmailAttachment, SendProviderEmail } from "../types.ts"

// Keyed on the configured values so changing them at /configure rebuilds the client.
let cachedClient: { cacheKey: string; client: SESv2Client } | undefined

async function getClient(): Promise<SESv2Client> {
  const [region, accessKeyId, secretAccessKey] = await Promise.all([
    getGlobalConfig("aws_region"),
    getGlobalConfig("aws_access_key_id"),
    getGlobalConfig("aws_secret_access_key"),
  ])
  if (!region) {
    throw new Error("SES is the selected email provider but no AWS region is configured")
  }
  // Standard AWS environment credentials belong to the SDK chain so temporary credentials retain
  // AWS_SESSION_TOKEN. Only database-backed static credentials are passed explicitly.
  const credentials = !process.env.AWS_ACCESS_KEY_ID && accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey }
    : null
  const cacheKey = `${region}:${credentials?.accessKeyId ?? ""}:${
    credentials?.secretAccessKey ?? ""
  }`
  if (cachedClient?.cacheKey !== cacheKey) {
    cachedClient = {
      cacheKey,
      client: new SESv2Client({
        region,
        // Without configured credentials, the default chain supports roles, SSO/profiles, and
        // temporary environment credentials. https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html
        ...(credentials ? { credentials } : {}),
      }),
    }
  }
  return cachedClient.client
}

export const sendSesEmail: SendProviderEmail = async (input) => {
  const response = await (await getClient()).send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: input.to },
      ...input.replyTo.length > 0 ? { ReplyToAddresses: input.replyTo } : {},
      // SESv2 Simple content cannot carry attachments, so those sends go out as raw MIME.
      // https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_EmailContent.html
      Content: input.attachments.length > 0 ? { Raw: { Data: buildMimeMessage(input) } } : {
        Simple: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: input.html, Charset: "UTF-8" },
            ...input.text ? { Text: { Data: input.text, Charset: "UTF-8" } } : {},
          },
        },
      },
    }),
  )
  return { messageId: response.MessageId }
}

function buildMimeMessage(input: ProviderEmailInput): Uint8Array {
  const mixedBoundary = `mixed_${crypto.randomUUID()}`
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    ...input.replyTo.length > 0 ? [`Reply-To: ${input.replyTo.join(", ")}`] : [],
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
  ]

  const parts = [
    `--${mixedBoundary}`,
    buildBodyPart(input),
    ...input.attachments.map((attachment) =>
      `--${mixedBoundary}\r\n${buildAttachmentPart(attachment)}`
    ),
    `--${mixedBoundary}--`,
  ]

  return new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n`)
}

/** A `multipart/alternative` body when a plain-text alternative exists, otherwise just the HTML. */
function buildBodyPart(input: ProviderEmailInput): string {
  const html = textPart("text/html", input.html)
  if (!input.text) return html

  // Least-preferred alternative first, as required by RFC 2046.
  // https://datatracker.ietf.org/doc/html/rfc2046#section-5.1.4
  const boundary = `alt_${crypto.randomUUID()}`
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart("text/plain", input.text),
    `--${boundary}`,
    html,
    `--${boundary}--`,
  ].join("\r\n")
}

function textPart(contentType: string, body: string): string {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(body, "utf8").toString("base64")),
  ].join("\r\n")
}

function buildAttachmentPart(attachment: ResolvedEmailAttachment): string {
  const filename = encodeHeaderValue(attachment.filename)
  return [
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(attachment.content).toString("base64")),
  ].join("\r\n")
}

/** RFC 2045 caps encoded lines at 76 characters. https://datatracker.ietf.org/doc/html/rfc2045#section-6.8 */
function wrapBase64(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n")
}

/** RFC 2047 encoded-word, so non-ASCII header values survive transport. */
function encodeHeaderValue(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
}
