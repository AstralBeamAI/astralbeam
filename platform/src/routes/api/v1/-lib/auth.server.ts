import { and, eq } from "drizzle-orm"
import { Duration, Effect } from "effect"
import { decodeProtectedHeader } from "jose"
import {
  authenticateOrganizationRequest,
  ORGANIZATION_TOKEN_TYPE,
} from "@/lib/auth/organization-token.server"
import { Database } from "@/db/database.server"
import { apiKey, organization } from "@/db/schema/organizations.server"
import { DatabaseRateLimiter, hashedRateLimitKey } from "@/db/lib/rate-limiter.server"
import { Tenants } from "@/lib/tenants/tenants.server"
import { ORGANIZATION_API_KEY_CONFIG_ID, parseApiKeyCredential } from "@/lib/api-keys/schemas"
import { Auth } from "@/lib/auth/auth.server"
import { authorizeOrganizationRole } from "@/lib/organizations/access"
import { authenticateChatRequest } from "@/lib/chat/auth.server"
import {
  RestInvalidCredentials,
  RestMembershipRequired,
  RestRateLimited,
  RestRoleForbidden,
  RestTenantAdminRequired,
} from "./errors.ts"
import type { RestScope } from "./shared.server"

const REST_CREDENTIAL_MAX_LENGTH = 16_384
const REST_RATE_LIMIT = { limit: 100, window: Duration.minutes(5) }

/** The credential a REST request carries, when it fits the accepted length. */
function readRestCredential(value: string | null | undefined): string | undefined {
  return value && value.length <= REST_CREDENTIAL_MAX_LENGTH ? value : undefined
}

export function readRestBearerToken(request: Request): string | undefined {
  return readRestCredential(/^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1])
}

export const decodeRestTokenType = Effect.fn("decodeRestTokenType")(function* (token: string) {
  const header = yield* Effect.try({
    try: () => decodeProtectedHeader(token),
    catch: () => new RestInvalidCredentials(),
  })
  return header.typ
})

/** Consumes one request from a hashed identity bucket, so the key never stores the identity. */
export const consumeRestRateLimit = Effect.fn("consumeRestRateLimit")(function* (
  namespace: string,
  identity: readonly string[],
  limits: { readonly limit: number; readonly window: Duration.Input } = REST_RATE_LIMIT,
) {
  const limiter = yield* DatabaseRateLimiter
  yield* limiter.consume({ key: hashedRateLimitKey(namespace, identity), ...limits }).pipe(
    Effect.catch((error) =>
      error.reason._tag === "RateLimitExceeded"
        ? Effect.fail(
            new RestRateLimited({
              retryAfterSeconds: Math.max(
                1,
                Math.ceil(Duration.toMillis(error.reason.retryAfter) / 1000),
              ),
            }),
          )
        : Effect.die(error),
    ),
  )
})

export const authenticateRestOrganizationToken = Effect.fn("authenticateRestOrganizationToken")(
  function* (request: Request) {
    return yield* authenticateOrganizationRequest(request).pipe(
      Effect.catchTags({
        OrganizationMembershipError: () => Effect.fail(new RestMembershipRequired()),
        ChatAuthenticationError: () => Effect.fail(new RestInvalidCredentials()),
      }),
    )
  },
)

export const authenticateRestTenantToken = Effect.fn("authenticateRestTenantToken")(function* (
  request: Request,
) {
  return yield* authenticateChatRequest(request).pipe(
    Effect.catchTag("ChatAuthenticationError", () => Effect.fail(new RestInvalidCredentials())),
  )
})

const authenticateRestApiKey = Effect.fn("authenticateRestApiKey")(function* (credential: string) {
  const parts = parseApiKeyCredential(credential)
  if (!parts) return yield* new RestInvalidCredentials()
  const auth = yield* Auth
  const verified = yield* auth.api((api) => api.verifyApiKey({ body: { key: parts.secret } }))
  if (!verified.valid || !verified.key) {
    if (verified.error?.code === "RATE_LIMITED") {
      const details = verified.error as { details?: { tryAgainIn?: unknown } }
      const milliseconds = details.details?.tryAgainIn
      return yield* new RestRateLimited({
        retryAfterSeconds:
          typeof milliseconds === "number" && Number.isFinite(milliseconds)
            ? Math.max(1, Math.ceil(milliseconds / 1000))
            : 300,
      })
    }
    return yield* new RestInvalidCredentials()
  }
  const database = yield* Database
  const [row] = yield* database
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(apiKey, eq(apiKey.organizationId, organization.id))
    .where(
      and(
        eq(organization.id, verified.key.referenceId),
        eq(organization.id, parts.organizationId),
        eq(apiKey.id, verified.key.id),
        eq(apiKey.id, parts.id),
        eq(apiKey.configId, ORGANIZATION_API_KEY_CONFIG_ID),
      ),
    )
    .limit(1)
    .pipe(Effect.orDie)
  if (!row) return yield* new RestInvalidCredentials()
  return { organizationId: row.id } satisfies RestScope["Service"]
})

/** Resolves the scope a REST credential may reach, rechecking membership and role each time. */
export const authenticateRestRequest = Effect.fn("authenticateRestRequest")(function* (
  request: Request,
) {
  const apiKeyHeader = request.headers.get("x-api-key")
  const credential = readRestCredential(apiKeyHeader ?? readRestBearerToken(request))
  if (!credential) return yield* new RestInvalidCredentials()
  if (apiKeyHeader !== null || credential.startsWith("key_")) {
    return yield* authenticateRestApiKey(credential)
  }
  if ((yield* decodeRestTokenType(credential)) === ORGANIZATION_TOKEN_TYPE) {
    const principal = yield* authenticateRestOrganizationToken(request)
    yield* consumeRestRateLimit("organization-rest", [
      principal.organizationId,
      principal.currentUser.id,
    ])
    const access = request.method === "GET" || request.method === "HEAD" ? "read" : "write"
    if (!authorizeOrganizationRole(principal.currentUser.role, { tenantManagement: [access] })) {
      return yield* new RestRoleForbidden()
    }
    return {
      organizationId: principal.organizationId,
      currentUser: principal.currentUser,
    } satisfies RestScope["Service"]
  }
  const principal = yield* authenticateRestTenantToken(request)
  if (principal.tenantUser.admin !== true) return yield* new RestTenantAdminRequired()
  const organizationId = principal.organization.id
  const externalTenantId = principal.tenantUser.tenant.id
  yield* consumeRestRateLimit("tenant-rest", [
    organizationId,
    externalTenantId,
    principal.tenantUser.id,
  ])
  const tenants = yield* Tenants
  const tenantId = yield* tenants.resolveId({ organizationId, externalId: externalTenantId })
  return { organizationId, tenantId, externalTenantId } satisfies RestScope["Service"]
})
