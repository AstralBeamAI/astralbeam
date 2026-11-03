import { getOrganization } from "@astralbeam/sdk/api"
import type { Cli } from "./options.ts"
import { env, stderr, stdin } from "node:process"
import { text } from "node:stream/consumers"
import {
  currentDirectory,
  DEFAULT_API_URL,
  displayPath,
  findBinding,
  type Organization,
  reportOrganization,
  organizationIdFromApiKey,
  readConfig,
  resolveCredentials,
  runState,
  validatedApiUrl,
  writeConfig,
} from "./config.ts"
import { printJson, printResult, printTable } from "./output.ts"

// Reads a pasted key without echoing it, like a password prompt. Raw mode goes on before the
// prompt appears, so a paste that arrives immediately is never echoed.
function promptSecret(question: string): Promise<string> {
  stdin.setRawMode(true)
  stderr.write(question)
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
  return (await text(stdin)).trim()
}

// Reading the organization proves the key and API URL work, and names the organization.
async function fetchOrganization(apiKey: string, apiUrl: string): Promise<Organization> {
  const keyOrganizationId = organizationIdFromApiKey(apiKey)
  const { id, name, slug } = await getOrganization({ apiKey, apiUrl })
  if (id !== keyOrganizationId) throw new Error("The API returned a different organization.")
  return { id, name, slug }
}

function maskApiKey(apiKey: string): string {
  return `${apiKey.slice(0, apiKey.indexOf("_abo_") + 5)}…${apiKey.slice(-4)}`
}

export function registerAuthCommands(auth: Cli): Cli {
  auth.command(
    "login",
    "Verify an API key, read from a hidden prompt or stdin, and bind it to this directory and everything below it",
    (y) =>
      y.option("api-url", {
        type: "string",
        description: `API base URL, ending in /api (default ${DEFAULT_API_URL})`,
      }),
    async (options) => {
      const apiUrl = validatedApiUrl(options.apiUrl ?? env["ASTRALBEAM_API_URL"] ?? DEFAULT_API_URL)
      const apiKey = await readApiKey()
      const organization = await fetchOrganization(apiKey, apiUrl)
      const directory = await currentDirectory()
      const config = await readConfig()
      config.bindings[directory] = { api_url: apiUrl, api_key: apiKey, organization }
      await writeConfig(config)
      reportOrganization({ apiKey, apiUrl, organization, directory })
      printResult({ directory, organization, api_url: apiUrl }, runState.json)
    },
  )

  auth.command({
    command: "logout",
    describe: "Remove the binding that covers this directory",
    handler: async () => {
      const config = await readConfig()
      const found = findBinding(config, await currentDirectory())
      if (!found) throw new Error("No AstralBeam login covers this directory.")
      delete config.bindings[found.directory]
      await writeConfig(config)
      const { organization } = found.binding
      printResult({ directory: found.directory, organization }, runState.json)
    },
  })

  auth.command({
    command: "status",
    describe: "Show which organization commands here use, and verify the key against the API",
    handler: async () => {
      const { apiKey, apiUrl, directory } = await resolveCredentials()
      const organization = await fetchOrganization(apiKey, apiUrl)
      if (runState.context) runState.context.organization = organization
      if (directory) {
        // Organizations can be renamed in the dashboard, so refresh what the context line shows.
        const config = await readConfig()
        const binding = config.bindings[directory]
        if (binding && JSON.stringify(binding.organization) !== JSON.stringify(organization)) {
          binding.organization = organization
          await writeConfig(config)
        }
      }
      const status = { organization, api_url: apiUrl, api_key: maskApiKey(apiKey) }
      printResult({ ...status, source: directory ?? "ASTRALBEAM_API_KEY" }, runState.json)
    },
  })

  auth.command({
    command: "list",
    describe: "List every directory binding",
    handler: async () => {
      const { bindings } = await readConfig()
      const rows = Object.entries(bindings).map(([directory, binding]) => ({
        directory,
        organization: binding.organization,
        api_url: binding.api_url,
      }))
      if (runState.json) return printJson({ items: rows })
      if (rows.length === 0) return void stderr.write("No bindings.\n")
      printTable(
        rows.map(({ directory, organization, api_url }) => ({
          directory: displayPath(directory),
          name: organization.name,
          slug: organization.slug,
          organization_id: organization.id,
          api_url,
        })),
        ["directory", "name", "slug", "organization_id", "api_url"],
      )
    },
  })
  return auth.demandCommand(1)
}
