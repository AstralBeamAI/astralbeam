import type { Command } from "commander"
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { isIPv4 } from "node:net"
import { homedir } from "node:os"
import { dirname, join, sep } from "node:path"
import { cwd, env, pid, platform, stderr } from "node:process"
import { terminalSafe } from "./output.ts"

export const DEFAULT_API_URL = "https://app.astralbeam.ai/api"
// key_<organization ID>_<key ID>_abo_<secret>, the format the dashboard issues.
const API_KEY_PATTERN = /^key_([0-9a-f-]{36})_[0-9a-f-]{36}_abo_[A-Za-z]{64}$/

export interface Organization {
  id: string
  name: string
  slug: string
}

/** A key bound to the directory `auth login` ran in, and to everything below it. */
export interface Binding {
  api_url: string
  api_key: string
  organization: Organization
}

interface ConfigFile {
  bindings: Record<string, Binding>
}

export interface Credentials {
  apiKey: string
  apiUrl: string
  organization: Partial<Organization> & { id: string }
  /** The bound directory, absent for `ASTRALBEAM_API_KEY`. */
  directory?: string
}

export function configPath(): string {
  if (env["ASTRALBEAM_CONFIG_DIR"]) return join(env["ASTRALBEAM_CONFIG_DIR"], "config.json")
  const base =
    platform === "win32"
      ? (env["APPDATA"] ?? homedir())
      : (env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"))
  return join(base, "astralbeam", "config.json")
}

export function organizationIdFromApiKey(apiKey: string): string {
  const organizationId = API_KEY_PATTERN.exec(apiKey)?.[1]
  if (!organizationId) {
    throw new Error("The API key must match key_<organizationId>_<id>_abo_<secret>.")
  }
  return organizationId
}

/** Rejects URLs that would send the key in plaintext, except to this machine. */
export function validatedApiUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`The API URL "${value}" is not a valid URL.`)
  }
  const host = url.hostname
  const loopback =
    host === "localhost" || host === "[::1]" || (isIPv4(host) && host.startsWith("127."))
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`The API URL "${value}" must use https://, or http:// only for localhost.`)
  }
  return value
}

export async function readConfig(): Promise<ConfigFile> {
  try {
    const config = JSON.parse(await readFile(configPath(), "utf8")) as Partial<ConfigFile>
    return { bindings: config.bindings ?? {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bindings: {} }
    throw error
  }
}

/** Writes a fresh owner-only file and renames it over the old one, so no reader sees a partial file. */
export async function writeConfig(config: ConfigFile): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${pid}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

/** The working directory with symlinks resolved, so a binding matches however it is reached. */
export async function currentDirectory(): Promise<string> {
  return await realpath(cwd())
}

/** The binding of `directory` or its nearest bound ancestor. */
export function findBinding(
  config: ConfigFile,
  directory: string,
): { directory: string; binding: Binding } | undefined {
  for (let current = directory; ; current = dirname(current)) {
    const binding = config.bindings[current]
    if (binding) return { directory: current, binding }
    if (dirname(current) === current) return undefined
  }
}

export function displayPath(directory: string): string {
  const home = homedir()
  return directory === home || directory.startsWith(home + sep)
    ? `~${directory.slice(home.length)}`
    : directory
}

/** The organization a run resolved, reported to stderr as JSON in JSON mode. */
export interface OrganizationContext {
  organization: Credentials["organization"]
  bound_directory: string | null
}

/**
 * Per-run output state. In JSON mode, stderr must be one JSON object, so the context is held
 * here and written by `program.ts` with the result or the error instead of as a text line.
 */
export const runState: { json: boolean; context: OrganizationContext | undefined } = {
  json: false,
  context: undefined,
}

/** Records the run's organization, printing it first to stderr in human-readable mode. */
export function reportOrganization(credentials: Credentials): void {
  runState.context = {
    organization: credentials.organization,
    bound_directory: credentials.directory ?? null,
  }
  if (!runState.json) stderr.write(organizationContext(credentials))
}

/** The organization line printed to stderr before a command's output. */
function organizationContext(credentials: Credentials): string {
  const { organization, directory } = credentials
  const name = organization.name
    ? `${terminalSafe(organization.name)} (${terminalSafe(organization.slug ?? "")}) · `
    : ""
  const source = directory ? `bound at ${displayPath(directory)}` : "from ASTRALBEAM_API_KEY"
  return `▸ ${name}org ${organization.id} · ${source}\n`
}

interface GlobalOptions {
  json: boolean
}

export function globalOptions(command: Command): GlobalOptions {
  return { json: command.optsWithGlobals<{ json?: boolean }>().json === true }
}

/** The SDK API client options for the current directory's credentials. */
export async function apiOptions(): Promise<{ apiKey: string; apiUrl: string }> {
  const { apiKey, apiUrl } = await resolveCredentials()
  return { apiKey, apiUrl }
}

/**
 * `ASTRALBEAM_API_KEY` wins, then the binding of the nearest bound directory. Reports the
 * organization on stderr so stdout stays parseable.
 */
export async function resolveCredentials(): Promise<Credentials> {
  const envApiKey = env["ASTRALBEAM_API_KEY"]
  let credentials: Credentials
  if (envApiKey) {
    credentials = {
      apiKey: envApiKey,
      apiUrl: validatedApiUrl(env["ASTRALBEAM_API_URL"] ?? DEFAULT_API_URL),
      organization: { id: organizationIdFromApiKey(envApiKey) },
    }
  } else {
    const directory = await currentDirectory()
    const found = findBinding(await readConfig(), directory)
    if (!found) {
      throw new Error(
        `No AstralBeam login covers ${displayPath(directory)}. Run \`astralbeam auth login\` in this directory or a parent, or set ASTRALBEAM_API_KEY.`,
      )
    }
    const { binding } = found
    credentials = {
      apiKey: binding.api_key,
      apiUrl: validatedApiUrl(binding.api_url),
      organization: binding.organization,
      directory: found.directory,
    }
  }
  reportOrganization(credentials)
  return credentials
}
