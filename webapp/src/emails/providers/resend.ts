import { Buffer } from "node:buffer"
import { Resend } from "resend"
import { requireResendConfig } from "../../lib/config.server.ts"
import type { SendProviderEmail } from "../types.ts"

let client: Resend | undefined

function getClient(): Resend {
  if (!client) client = new Resend(requireResendConfig().apiKey)
  return client
}

export const sendProviderEmail: SendProviderEmail = async (input) => {
  const { data, error } = await getClient().emails.send({
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
