import { Buffer } from "node:buffer"
import { createServer as createHttpServer } from "node:http"
import { createServer as createTcpServer, type Socket } from "node:net"
import process from "node:process"

import type { MailboxMessage } from "./mailbox.ts"

/**
 * A throwaway SMTP sink with a read-only HTTP API, so the suite can assert on the email the
 * application actually sent without Docker, Mailpit, or a network. See `e2e/README.md`.
 */

const MAILBOX_CAPACITY = 200

const messages: MailboxMessage[] = []
let nextMessageId = 1

function decodeQuotedPrintable(body: string): Uint8Array {
  const unfolded = body.replace(/=\r?\n/g, "")
  const bytes: number[] = []
  for (let index = 0; index < unfolded.length; index += 1) {
    const character = unfolded[index]!
    const hex = character === "=" ? unfolded.slice(index + 1, index + 3) : null
    if (hex && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
      continue
    }
    bytes.push(character.charCodeAt(0) & 0xff)
  }
  return Uint8Array.from(bytes)
}

/** `body` holds one byte per character, so a transfer encoding decodes to bytes before UTF-8 does. */
function decodeBody(body: string, encoding: string): string {
  if (encoding === "quoted-printable") return new TextDecoder().decode(decodeQuotedPrintable(body))
  if (encoding === "base64") return Buffer.from(body, "base64").toString("utf8")
  return Buffer.from(body, "binary").toString("utf8")
}

/** RFC 2047 encoded words, which nodemailer uses for any header that is not plain ASCII. */
function decodeHeaderText(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (_match, _charset: string, encoding: string, text: string) =>
      encoding.toLowerCase() === "b"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeBody(text.replace(/_/g, " "), "quoted-printable"),
  )
}

function splitHeadersAndBody(raw: string): { headers: Map<string, string>; body: string } {
  const separator = raw.search(/\r?\n\r?\n/)
  const headerText = separator === -1 ? raw : raw.slice(0, separator)
  const body = separator === -1 ? "" : raw.slice(separator).replace(/^\r?\n\r?\n/, "")
  const headers = new Map<string, string>()
  // Continuation lines start with whitespace and belong to the header above them.
  for (const line of headerText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const match = /^([^:]+):\s?(.*)$/.exec(line)
    if (match?.[1]) headers.set(match[1].toLowerCase(), match[2] ?? "")
  }
  return { headers, body }
}

function collectParts(raw: string, into: { text: string; html: string }): void {
  const { headers, body } = splitHeadersAndBody(raw)
  const contentType = headers.get("content-type") ?? "text/plain"
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1]
  if (boundary) {
    const sections = body.split(`--${boundary}`).slice(1, -1)
    for (const section of sections) collectParts(section.replace(/^\r?\n/, ""), into)
    return
  }
  const decoded = decodeBody(body, (headers.get("content-transfer-encoding") ?? "").toLowerCase())
  if (contentType.includes("text/html")) into.html += decoded
  else if (contentType.includes("text/plain")) into.text += decoded
}

function storeMessage(recipients: string[], raw: string): void {
  const { headers } = splitHeadersAndBody(raw)
  const parts = { text: "", html: "" }
  collectParts(raw, parts)
  messages.push({
    id: nextMessageId++,
    receivedAt: new Date().toISOString(),
    from: decodeHeaderText(headers.get("from") ?? ""),
    to: recipients,
    subject: decodeHeaderText(headers.get("subject") ?? ""),
    ...parts,
  })
  if (messages.length > MAILBOX_CAPACITY) messages.splice(0, messages.length - MAILBOX_CAPACITY)
}

function addressOf(command: string): string {
  return /<([^>]*)>/.exec(command)?.[1] ?? command.split(/\s+/)[1] ?? ""
}

function handleSmtpConnection(socket: Socket): void {
  let recipients: string[] = []
  let dataLines: string[] | null = null
  let pending = ""

  const reply = (line: string) => socket.write(`${line}\r\n`)
  reply("220 astralbeam-e2e ESMTP")

  const handleLine = (line: string) => {
    if (dataLines) {
      if (line === ".") {
        storeMessage(recipients, dataLines.join("\r\n"))
        recipients = []
        dataLines = null
        reply("250 2.0.0 Ok: queued")
        return
      }
      // Undo dot-stuffing, which protects a body line that would otherwise end the message.
      dataLines.push(line.startsWith("..") ? line.slice(1) : line)
      return
    }

    const verb = line.split(/\s+/)[0]?.toUpperCase() ?? ""
    if (verb === "EHLO") reply("250-astralbeam-e2e\r\n250 8BITMIME")
    else if (verb === "HELO") reply("250 astralbeam-e2e")
    else if (verb === "MAIL") reply("250 2.1.0 Ok")
    else if (verb === "RCPT") {
      recipients.push(addressOf(line))
      reply("250 2.1.5 Ok")
    } else if (verb === "DATA") {
      dataLines = []
      reply("354 End data with <CR><LF>.<CR><LF>")
    } else if (verb === "RSET") {
      recipients = []
      dataLines = null
      reply("250 2.0.0 Ok")
    } else if (verb === "NOOP") reply("250 2.0.0 Ok")
    else if (verb === "QUIT") {
      reply("221 2.0.0 Bye")
      socket.end()
    } else reply(`502 5.5.2 Unrecognized command: ${verb}`)
  }

  socket.on("data", (chunk: Buffer) => {
    pending += chunk.toString("binary")
    let breakIndex = pending.indexOf("\r\n")
    while (breakIndex !== -1) {
      const line = pending.slice(0, breakIndex)
      pending = pending.slice(breakIndex + 2)
      handleLine(line)
      breakIndex = pending.indexOf("\r\n")
    }
  })
  socket.on("error", () => socket.destroy())
}

const smtpPort = Number(process.env.E2E_SMTP_PORT ?? 1025)
const apiPort = Number(process.env.E2E_MAILBOX_PORT ?? 8025)

createTcpServer(handleSmtpConnection).listen(smtpPort, "127.0.0.1", () => {
  console.log(`Mailbox SMTP listening on 127.0.0.1:${smtpPort}`)
})

createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${apiPort}`)
  response.setHeader("content-type", "application/json")
  if (url.pathname === "/health") {
    response.end(JSON.stringify({ ok: true, smtpPort }))
    return
  }
  if (url.pathname !== "/messages") {
    response.statusCode = 404
    response.end(JSON.stringify({ error: "Not found" }))
    return
  }
  const recipient = url.searchParams.get("to")?.toLowerCase()
  const matching = recipient
    ? messages.filter((message) => message.to.some((to) => to.toLowerCase() === recipient))
    : messages
  response.end(JSON.stringify({ messages: [...matching].reverse() }))
}).listen(apiPort, "127.0.0.1", () => {
  console.log(`Mailbox API listening on http://127.0.0.1:${apiPort}`)
})
