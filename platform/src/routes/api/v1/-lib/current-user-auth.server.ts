import { Effect } from "effect"
import { TenantUsers } from "@/lib/tenants/tenant-users"
import { CHAT_AUTH_TOKEN_TYPE } from "@/lib/chat/constants"
import { ORGANIZATION_TOKEN_TYPE } from "@/lib/auth/organization-token.server"
import {
  authenticateRestOrganizationToken,
  authenticateRestTenantToken,
  consumeRestRateLimit,
  decodeRestTokenType,
  readRestBearerToken,
} from "./auth.server"
import { RestInvalidCredentials } from "./errors.ts"

/** Resolves `POST /me`, which accepts JWTs only and synchronizes a tenant JWT's identity. */
export const getCurrentUser = Effect.fn("getCurrentUser")(function* (request: Request) {
  const token = readRestBearerToken(request)
  if (!token || request.headers.has("x-api-key")) return yield* new RestInvalidCredentials()
  const type = yield* decodeRestTokenType(token)
  if (type === ORGANIZATION_TOKEN_TYPE) {
    const principal = yield* authenticateRestOrganizationToken(request)
    yield* consumeRestRateLimit("current-user", [
      "organization",
      principal.organizationId,
      principal.currentUser.id,
    ])
    return {
      scope: "organization" as const,
      organization: { id: principal.organizationId },
      user: principal.currentUser,
    }
  }
  if (type !== CHAT_AUTH_TOKEN_TYPE) return yield* new RestInvalidCredentials()
  const principal = yield* authenticateRestTenantToken(request)
  yield* consumeRestRateLimit("current-user", [
    "tenant",
    principal.organization.id,
    principal.tenantUser.tenant.id,
    principal.tenantUser.id,
  ])
  const tenantUsers = yield* TenantUsers
  const records = yield* tenantUsers.syncCurrentUser({ principal })
  return { scope: "tenant" as const, organization: principal.organization, ...records }
})
