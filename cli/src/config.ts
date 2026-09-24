import type { Command } from "commander"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { env, platform } from "node:process"

export const DEFAULT_API_URL = "https://app.astralbeam.ai/api"
const DEFAULT_PROFILE = "default"
// key_<organization ID>_<key ID>_abo_<secret>, the format the dashboard issues.
const API_KEY_PATTERN = /^key_([0-9a-f-]{36})_[0-9a-f-]{36}_abo_[A-Za-z]{64}$/

interface Profile {
  api_url: string
  api_key: string
}

interface ConfigFile {
  profiles: Record<string, Profile>
}

export interface Credentials {
  apiKey: string
  apiUrl: string
  /** Where the key came from: the environment or a named profile. */
  source: string
}

export function configPath(): string {
  if (env["ASTRALBEAM_CONFIG_DIR"]) return join(env["ASTRALBEAM_CONFIG_DIR"], "config.json")
  const base =
    platform === "win32"
      ? (env["APPDATA"] ?? homedir())
      : (env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"))
  return join(base, "astralbeam", "config.json")
}

export function profileName(profile: string | undefined): string {
  return profile ?? env["ASTRALBEAM_PROFILE"] ?? DEFAULT_PROFILE
}

export function organizationIdFromApiKey(apiKey: string): string {
  const organizationId = API_KEY_PATTERN.exec(apiKey)?.[1]
  if (!organizationId)
    throw new Error("The API key must match key_<organizationId>_<id>_abo_<secret>.")
  return organizationId
}

export async function readConfig(): Promise<ConfigFile> {
  try {
    const config = JSON.parse(await readFile(configPath(), "utf8")) as Partial<ConfigFile>
    return { profiles: config.profiles ?? {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {} }
    throw error
  }
}

export async function writeConfig(config: ConfigFile): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  // The mode above applies only when the file is created.
  await chmod(path, 0o600)
}

interface GlobalOptions {
  json: boolean
  profile: string | undefined
}

export function globalOptions(command: Command): GlobalOptions {
  const { json, profile } = command.optsWithGlobals<{ json?: boolean; profile?: string }>()
  return { json: json === true, profile }
}

/** The SDK API client options for a command's resolved credentials. */
export async function apiOptions(command: Command): Promise<{ apiKey: string; apiUrl: string }> {
  const { apiKey, apiUrl } = await resolveCredentials(globalOptions(command).profile)
  return { apiKey, apiUrl }
}

/** An explicit `--profile` wins, then `ASTRALBEAM_API_KEY`, then the selected stored profile. */
export async function resolveCredentials(profile: string | undefined): Promise<Credentials> {
  const envApiKey = env["ASTRALBEAM_API_KEY"]
  if (profile === undefined && envApiKey) {
    return {
      apiKey: envApiKey,
      apiUrl: env["ASTRALBEAM_API_URL"] ?? DEFAULT_API_URL,
      source: "ASTRALBEAM_API_KEY",
    }
  }
  const name = profileName(profile)
  const stored = (await readConfig()).profiles[name]
  if (!stored) {
    throw new Error(
      `No credentials for profile "${name}". Run \`astralbeam auth login\` or set ASTRALBEAM_API_KEY.`,
    )
  }
  return {
    apiKey: stored.api_key,
    apiUrl: env["ASTRALBEAM_API_URL"] ?? stored.api_url,
    source: `profile "${name}"`,
  }
}
