import { Buffer } from "node:buffer"
import { Resend } from "resend"
import { requireResendConfig } from "../../lib/config.server.ts"
import type { SendProviderEmail } from "../types.ts"

// Keyed on the API key so rotating it at /configure rebuilds the client.
let cachedClient: { apiKey: string; client: Resend } | undefined

async function getClient(): Promise<Resend> {
  const { apiKey } = await requireResendConfig()
  if (cachedClient?.apiKey !== apiKey) cachedClient = { apiKey, client: new Resend(apiKey) }
  return cachedClient.client
}

export const sendProviderEmail: SendProviderEmail = async (input) => {
  const { data, error } = await (await getClient()).emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...input.text ? { text: input.text } : {},
    ...input.replyTo.length > 0 ? { replyTo: input.replyTo } : {},
    attachments: input.attachments.map(({ filename, contentType, content }) => ({
      filename,
      contentType,
      content: Buffer.from(content),
    })),
  })
  if (error) {
    throw new Error(`Resend failed to send email: ${error.name}: ${error.message}`)
  }
  return { messageId: data?.id }
}
