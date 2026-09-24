import {
  createAstralBeamOrganizationToken,
  createAstralBeamToken,
  type Tenant,
  type TenantUser,
} from "@astralbeam/sdk/server"
import type { Command } from "commander"
import { stdout } from "node:process"
import { globalOptions, organizationIdFromApiKey, resolveCredentials } from "./config.ts"
import { lifetimeSeconds } from "./options.ts"
import { printJson } from "./output.ts"

export interface IdentityOptions {
  tenant: string
  user: string
  tenantName?: string
  userName?: string
  admin?: boolean
  expiresIn?: number
}

/** Adds the flags naming the Tenant and TenantUser a chat token signs for. */
export function addIdentityOptions(command: Command): Command {
  return command
    .requiredOption("--tenant <external-id>", "Tenant external ID, signed as tenant.id")
    .requiredOption("--user <external-id>", "TenantUser external ID, signed as user.id")
    .option("--tenant-name <name>", "Tenant display name")
    .option("--user-name <name>", "TenantUser display name")
    .option("--admin", "sign user.admin: true, granting Tenant admin API access")
    .option("--expires-in <seconds>", "token lifetime, 60-600 (default 300)", lifetimeSeconds)
}

export function chatIdentity(options: IdentityOptions): { tenant: Tenant; user: TenantUser } {
  return {
    tenant: {
      id: options.tenant,
      ...(options.tenantName === undefined ? {} : { name: options.tenantName }),
    },
    user: {
      id: options.user,
      ...(options.userName === undefined ? {} : { name: options.userName }),
      ...(options.admin ? { admin: true } : {}),
    },
  }
}

function printToken(token: string, expiresInSeconds: number, json: boolean) {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  if (json) printJson({ token, expires_at: expiresAt })
  else stdout.write(`${token}\n`)
}

export function registerTokenCommands(program: Command): void {
  const token = program
    .command("token")
    .description("Mint short-lived JWTs offline with the organization API key")

  addIdentityOptions(
    token
      .command("chat")
      .description("Mint a chat JWT for a Tenant's user, as a token endpoint would"),
  ).action(async (options: IdentityOptions, command: Command) => {
    const { apiKey } = await resolveCredentials()
    const expiresInSeconds = options.expiresIn ?? 300
    const jwt = await createAstralBeamToken({ apiKey, expiresInSeconds, ...chatIdentity(options) })
    printToken(jwt, expiresInSeconds, globalOptions(command).json)
  })

  token
    .command("organization")
    .description("Mint an organization-management JWT delegating a member's current role")
    .requiredOption("--email <email>", "email of an existing member of the organization")
    .option("--expires-in <seconds>", "token lifetime, 60-600 (default 300)", lifetimeSeconds)
    .action(async (options: { email: string; expiresIn?: number }, command: Command) => {
      const { apiKey } = await resolveCredentials()
      const expiresInSeconds = options.expiresIn ?? 300
      const jwt = await createAstralBeamOrganizationToken({
        apiKey,
        email: options.email,
        organizationId: organizationIdFromApiKey(apiKey),
        expiresInSeconds,
      })
      printToken(jwt, expiresInSeconds, globalOptions(command).json)
    })
}
