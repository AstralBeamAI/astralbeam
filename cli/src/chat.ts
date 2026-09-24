import { type AstralBeamChatCore, createAstralBeamChat } from "@astralbeam/sdk/core"
import { createAstralBeamToken } from "@astralbeam/sdk/server"
import type { Command } from "commander"
import { stderr, stdin, stdout } from "node:process"
import { createInterface } from "node:readline/promises"
import { globalOptions, resolveCredentials } from "./config.ts"
import { printJson } from "./output.ts"
import { addIdentityOptions, chatIdentity, type IdentityOptions } from "./token.ts"

type Message = ReturnType<AstralBeamChatCore["getState"]>["messages"][number]

function replyText(messages: readonly Message[]): string {
  return messages
    .filter((message) => message.role === "assistant")
    .map((message) =>
      message.parts.map((part) => (part.type === "text" ? part.content : "")).join(""),
    )
    .filter(Boolean)
    .join("\n\n")
}

/** Sends one message, streaming the reply to stdout, or printing its messages in JSON mode. */
async function sendChatMessage(chat: AstralBeamChatCore, content: string, json: boolean) {
  const start = chat.getState().messages.length
  let printed = ""
  const announcedTools = new Set<string>()
  const unsubscribe = chat.subscribe(() => {
    if (json) return
    const messages = chat.getState().messages.slice(start)
    const text = replyText(messages)
    if (text.startsWith(printed)) {
      stdout.write(text.slice(printed.length))
      printed = text
    }
    for (const part of messages.flatMap((message) => message.parts)) {
      if (part.type !== "tool-call" || announcedTools.has(part.id)) continue
      announcedTools.add(part.id)
      stderr.write(`[tool ${part.name}]\n`)
    }
  })
  try {
    await chat.sendMessage(content)
  } finally {
    unsubscribe()
  }
  const { error, messages } = chat.getState()
  if (error) throw error
  if (json) printJson({ messages: messages.slice(start) })
  else if (!printed.endsWith("\n")) stdout.write("\n")
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8").trim()
}

async function chatInteractively(chat: AstralBeamChatCore) {
  const prompt = createInterface({ input: stdin, output: stdout })
  stderr.write("Type a message, or /exit to quit.\n")
  try {
    for (;;) {
      const line = (await prompt.question("> ").catch(() => "/exit")).trim()
      if (line === "/exit") return
      if (line) await sendChatMessage(chat, line, false)
    }
  } finally {
    prompt.close()
  }
}

export function registerChatCommand(program: Command): void {
  addIdentityOptions(
    program
      .command("chat")
      .description("Chat with an agent as one of a Tenant's users, like the embedded widget")
      .argument(
        "[message]",
        "message to send (default: stdin when piped, else an interactive prompt)",
      )
      .option("--agent <id>", "public agent ID (default: the organization's default agent)"),
  ).action(
    async (
      message: string | undefined,
      options: IdentityOptions & { agent?: string },
      command: Command,
    ) => {
      const { json, profile } = globalOptions(command)
      const { apiKey, apiUrl } = await resolveCredentials(profile)
      const expiresInSeconds = options.expiresIn ?? 300
      const identity = chatIdentity(options)
      const chat = createAstralBeamChat({
        apiUrl,
        ...(options.agent === undefined ? {} : { agentId: options.agent }),
        fetchAstralBeamToken: async () => ({
          token: await createAstralBeamToken({ apiKey, expiresInSeconds, ...identity }),
        }),
      })
      try {
        if (message !== undefined) await sendChatMessage(chat, message, json)
        else if (!stdin.isTTY) await sendChatMessage(chat, await readStdin(), json)
        else if (json) command.error("Pass a message or pipe one on stdin with --json.")
        else await chatInteractively(chat)
      } finally {
        chat.dispose()
      }
    },
  )
}
