import { listTenants } from "@astralbeam/sdk/api"
import type { Command } from "commander"
import { env, stderr, stdin } from "node:process"
import {
  configPath,
  DEFAULT_API_URL,
  globalOptions,
  organizationIdFromApiKey,
  profileName,
  readConfig,
  resolveCredentials,
  writeConfig,
} from "./config.ts"
import { printResult } from "./output.ts"

// Reads a pasted key without echoing it, like a password prompt.
function promptSecret(question: string): Promise<string> {
  stderr.write(question)
  stdin.setRawMode(true)
  stdin.setEncoding("utf8")
  stdin.resume()
  let value = ""
  return new Promise((resolve, reject) => {
    const finish = () => {
      stdin.off("data", onData)
      stdin.setRawMode(false)
      stdin.pause()
      stderr.write("\n")
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish()
          return resolve(value.trim())
        }
        if (char === "\u0003") {
          finish()
          return reject(new Error("Cancelled."))
        }
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char
      }
    }
    stdin.on("data", onData)
  })
}

async function readApiKey(): Promise<string> {
  if (stdin.isTTY) return await promptSecret("Paste an organization API key: ")
  const chunks: Buffer[] = []
  for await (const chunk of stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8").trim()
}

// A one-item listing proves the key, its organization, and the API URL all work together.
async function verifyApiKey(apiKey: string, apiUrl: string): Promise<string> {
  const organizationId = organizationIdFromApiKey(apiKey)
  await listTenants({ page_size: 1 }, { apiKey, apiUrl })
  return organizationId
}

function maskApiKey(apiKey: string): string {
  return `${apiKey.slice(0, apiKey.indexOf("_abo_") + 5)}…${apiKey.slice(-4)}`
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Store and check organization API keys")

  auth
    .command("login")
    .description("Verify an API key, read from a hidden prompt or stdin, and store it in a profile")
    .option("--api-url <url>", `API base URL, ending in /api (default ${DEFAULT_API_URL})`)
    .action(async (options: { apiUrl?: string }, command: Command) => {
      const { json, profile } = globalOptions(command)
      const name = profileName(profile)
      const apiUrl = options.apiUrl ?? env["ASTRALBEAM_API_URL"] ?? DEFAULT_API_URL
      const apiKey = await readApiKey()
      const organizationId = await verifyApiKey(apiKey, apiUrl)
      const config = await readConfig()
      config.profiles[name] = { api_url: apiUrl, api_key: apiKey }
      await writeConfig(config)
      if (!json) stderr.write(`Stored in ${configPath()}\n`)
      printResult({ profile: name, organization_id: organizationId, api_url: apiUrl }, json)
    })

  auth
    .command("logout")
    .description("Delete a stored profile")
    .action(async (_options: object, command: Command) => {
      const { json, profile } = globalOptions(command)
      const name = profileName(profile)
      const config = await readConfig()
      const removed = name in config.profiles
      delete config.profiles[name]
      if (removed) await writeConfig(config)
      printResult({ profile: name, removed }, json)
    })

  auth
    .command("status")
    .description("Show which credentials commands use, and verify them against the API")
    .action(async (_options: object, command: Command) => {
      const { json, profile } = globalOptions(command)
      const { apiKey, apiUrl, source } = await resolveCredentials(profile)
      const organizationId = await verifyApiKey(apiKey, apiUrl)
      const status = { source, organization_id: organizationId, api_url: apiUrl }
      printResult({ ...status, api_key: maskApiKey(apiKey) }, json)
    })
}
