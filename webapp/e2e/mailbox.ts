import { mailboxUrl } from "./worktree.ts"

/** One captured message. `mailbox-server.ts` produces these; specs only ever read them. */
export type MailboxMessage = {
  id: number
  receivedAt: string
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}

const MAILBOX_WAIT_TIMEOUT_MS = 30_000
const MAILBOX_POLL_MS = 250

async function listMailboxMessages(recipient?: string): Promise<MailboxMessage[]> {
  const url = new URL("/messages", mailboxUrl)
  if (recipient) url.searchParams.set("to", recipient)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The mailbox answered ${response.status}`)
  return (await response.json() as { messages: MailboxMessage[] }).messages
}

/**
 * Waits for the newest message to a recipient. Pass `afterId` when an earlier message to the same
 * address is already in the mailbox and only a later one counts.
 */
export async function waitForEmail(
  recipient: string,
  options: { subject?: RegExp; afterId?: number; timeoutMs?: number } = {},
): Promise<MailboxMessage> {
  const deadline = Date.now() + (options.timeoutMs ?? MAILBOX_WAIT_TIMEOUT_MS)
  const afterId = options.afterId ?? 0
  while (Date.now() < deadline) {
    const candidates = (await listMailboxMessages(recipient))
      .filter((message) => message.id > afterId)
      .filter((message) => !options.subject || options.subject.test(message.subject))
    if (candidates[0]) return candidates[0]
    await new Promise((resolve) => setTimeout(resolve, MAILBOX_POLL_MS))
  }
  const seen = (await listMailboxMessages())
    .map((message) => `${message.to.join(", ")} ${message.subject}`)
  throw new Error(
    `No email to ${recipient} arrived within the timeout. Mailbox held: ${
      seen.join("; ") || "nothing"
    }`,
  )
}

/** The first link in a message matching `pattern`, from either the text or the HTML part. */
export function emailLink(message: MailboxMessage, pattern: RegExp): string {
  const found = [...`${message.text}\n${message.html}`.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)]
    .map((match) => match[0].replaceAll("&amp;", "&").replace(/[.,;:]+$/, ""))
    .find((link) => pattern.test(link))
  if (!found) throw new Error(`No link matching ${pattern} in "${message.subject}"`)
  return found
}
