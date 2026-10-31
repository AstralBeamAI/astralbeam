import {
  createAstralBeamOrganizationToken,
  createAstralBeamToken,
  type Tenant,
  type TenantUser,
} from "@astralbeam/sdk/server"
import { stdout } from "node:process"
import { runState, organizationIdFromApiKey, resolveCredentials } from "./config.ts"
import { lifetimeSeconds, type Cli } from "./options.ts"
import { printJson } from "./output.ts"

interface IdentityOptions {
  tenant: string
  user: string
  tenantName?: string | undefined
  userName?: string | undefined
  admin?: boolean | undefined
  expiresIn?: number | undefined
}

/** Adds the flags naming the Tenant and TenantUser a chat token signs for. */
export function addIdentityOptions(command: Cli) {
  return command
    .string(["tenant", "user", "tenant-name", "user-name"])
    .demandOption(["tenant", "user"])
    .boolean("admin")
    .number("expires-in")
    .coerce("expires-in", lifetimeSeconds)
    .describe({
      tenant: "Tenant external ID, signed as tenant.id",
      user: "TenantUser external ID, signed as user.id",
      "tenant-name": "Tenant display name",
      "user-name": "TenantUser display name",
      admin: "sign user.admin: true, granting Tenant admin API access",
      "expires-in": "token lifetime, 60-600 (default 300)",
    })
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

export function registerTokenCommands(token: Cli): Cli {
  token.command(
    "chat",
    "Mint a chat JWT for a Tenant's user, as a token endpoint would",
    addIdentityOptions,
    async (options) => {
      const { apiKey } = await resolveCredentials()
      const expiresInSeconds = options.expiresIn ?? 300
      const jwt = await createAstralBeamToken({
        apiKey,
        expiresInSeconds,
        ...chatIdentity(options),
      })
      printToken(jwt, expiresInSeconds, runState.json)
    },
  )

  token.command(
    "organization",
    "Mint an organization-management JWT delegating a member's current role",
    (y) =>
      y
        .string("email")
        .demandOption("email")
        .number("expires-in")
        .coerce("expires-in", lifetimeSeconds)
        .describe({
          email: "email of an existing member of the organization",
          "expires-in": "token lifetime, 60-600 (default 300)",
        }),
    async (options) => {
      const { apiKey } = await resolveCredentials()
      const expiresInSeconds = options.expiresIn ?? 300
      const jwt = await createAstralBeamOrganizationToken({
        apiKey,
        email: options.email,
        organizationId: organizationIdFromApiKey(apiKey),
        expiresInSeconds,
      })
      printToken(jwt, expiresInSeconds, runState.json)
    },
  )
  return token.demandCommand(1)
}
