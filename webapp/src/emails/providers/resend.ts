import { Buffer } from "node:buffer"
import { Resend } from "resend"
import { getGlobalConfig } from "@/lib/config"
import type { SendProviderEmail } from "../types.ts"

export const sendResendEmail: SendProviderEmail = async (input) => {
  // The constructor only stores the key and sends over global fetch, so there is nothing to reuse.
  const apiKey = await getGlobalConfig("resend_api_key")
  if (!apiKey) {
    throw new Error("Resend is the selected email provider but no Resend API key is configured")
  }
  const { data, error } = await new Resend(apiKey).emails.send({
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
