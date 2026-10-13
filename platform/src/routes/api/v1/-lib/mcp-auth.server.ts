import { Effect } from "effect"
import { ChatThreads } from "@/lib/chat/threads/threads"
import { ORGANIZATION_TOKEN_TYPE } from "@/lib/auth/organization-token.server"
import { authorizeOrganizationRole } from "@/lib/organizations/access"
import type { McpActor, McpOwner } from "@/lib/mcp/schemas"
import { McpForbidden } from "@/lib/mcp/errors"
import {
  authenticateRestRequest,
  authenticateRestTenantToken,
  consumeRestRateLimit,
  decodeRestTokenType,
  readRestBearerToken,
} from "./auth.server"
import { RestInvalidCredentials, RestResourceNotFound } from "./errors.ts"

export const authenticateMcpRequest = Effect.fn("authenticateMcpRequest")(function* (
  request: Request,
) {
  const token = readRestBearerToken(request)
  if (
    request.headers.has("x-api-key") ||
    token?.startsWith("key_") ||
    (token && (yield* decodeRestTokenType(token)) === ORGANIZATION_TOKEN_TYPE)
  ) {
    const scope = yield* authenticateRestRequest(request)
    const currentUser = "currentUser" in scope ? scope.currentUser : undefined
    if (
      currentUser &&
      !authorizeOrganizationRole(currentUser.role, {
        organizationConfiguration: [request.method === "GET" ? "read" : "update"],
      })
    )
      return yield* new McpForbidden()
    return {
      organizationId: scope.organizationId,
      tenantId: null,
      tenantUserId: null,
      organizationUserId: currentUser?.id ?? null,
      admin: true,
      apiKey: !currentUser,
      interactive: false,
    } satisfies McpActor
  }
  if (!token) return yield* new RestInvalidCredentials()
  const principal = yield* authenticateRestTenantToken(request)
  const threads = yield* ChatThreads
  const scope = yield* threads
    .resolveScope({ principal })
    .pipe(Effect.mapError(() => new RestResourceNotFound()))
  yield* consumeRestRateLimit("mcp", [scope.organizationId, scope.tenantId, scope.tenantUserId])
  return {
    ...scope,
    organizationUserId: null,
    admin: principal.tenantUser.admin === true,
    apiKey: false,
    interactive: true,
  } satisfies McpActor
})

export function mcpRequestOwner(
  actor: McpActor,
  kind: "organization" | "tenant" | "personal",
  tenantId?: string,
): McpOwner | null {
  if (kind === "personal")
    return actor.tenantId && actor.tenantUserId && !actor.apiKey
      ? {
          organizationId: actor.organizationId,
          tenantId: actor.tenantId,
          tenantUserId: actor.tenantUserId,
        }
      : null
  if (kind === "organization")
    return actor.tenantId === null
      ? { organizationId: actor.organizationId, tenantId: null, tenantUserId: null }
      : null
  if (!tenantId || (actor.tenantId !== null && (actor.tenantId !== tenantId || !actor.admin)))
    return null
  return { organizationId: actor.organizationId, tenantId, tenantUserId: null }
}
