import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { Effect } from "effect"
import { SignJWT } from "jose"

import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { ApiKeys } from "@/lib/api-keys/api-keys.server"
import { formatApiKeyId, parseApiKeyCredential } from "@/lib/api-keys/schemas"
import { Config } from "@/lib/config/config.server"
import { APP_HANDLE } from "@/lib/constants"
import { authorizeOrganizationRole } from "@/lib/organizations/access"
import { OrganizationNotFound } from "@/lib/organizations/errors"
import { Organizations } from "@/lib/organizations/organizations.server"
import { Auth } from "./auth.server.ts"
import {
  DashboardTokenRateLimited,
  EmbeddedAssistantUnavailable,
  OrganizationApiKeysMissing,
  OrganizationApiKeyUnavailable,
  TenantAccessDenied,
} from "./errors.ts"
import { ORGANIZATION_TOKEN_TYPE } from "./organization-token.server.ts"

/**
 * Issues the displayed Organization's token for a signed-in member: an organization-management
 * JWT for directories, or a dogfood chat token otherwise. Rate-limited per user before signing.
 */
export const issueDashboardToken = Effect.fn("issueDashboardToken")(function* (input: {
  organizationSlug: string
  headers: Headers
  scope?: "organization" | undefined
}) {
  const session = yield* Effect.flatMap(Auth, (auth) =>
    auth.requireSession({ headers: input.headers }),
  )
  yield* Effect.flatMap(DatabaseRateLimiter, (limiter) =>
    limiter.consume({ key: `dashboard-token:${session.user.id}`, limit: 60, window: "1 minute" }),
  ).pipe(
    Effect.catch((error) =>
      error.reason._tag === "RateLimitExceeded"
        ? Effect.fail(new DashboardTokenRateLimited())
        : Effect.die(error),
    ),
  )
  const organization = yield* Effect.flatMap(Organizations, (organizations) =>
    organizations.membership({
      organizationSlug: input.organizationSlug,
      userId: session.user.id,
    }),
  )
  if (!organization) return yield* new OrganizationNotFound()
  if (input.scope === "organization") {
    if (!authorizeOrganizationRole(organization.role, { tenantManagement: ["read"] })) {
      return yield* new TenantAccessDenied()
    }
    return yield* issueDashboardOrganizationToken(organization.organizationId, session.user.email)
  }
  const config = yield* Config
  const organizationId = yield* config.get("dogfood_organization_id")
  const apiKey = yield* config.get("dogfood_api_key")
  if (!organizationId || parseApiKeyCredential(apiKey)?.organizationId !== organizationId) {
    return yield* new EmbeddedAssistantUnavailable()
  }
  const token = yield* Effect.tryPromise(() =>
    createAstralBeamToken({
      apiKey: apiKey!,
      tenant: {
        id: organization.organizationId,
        name: organization.organizationName,
        metadata: { slug: organization.organizationSlug },
      },
      user: {
        id: session.user.id,
        name: session.user.name,
        admin: false,
        metadata: { email: session.user.email },
      },
    }),
  ).pipe(Effect.orDie)
  return { token }
})

const issueDashboardOrganizationToken = Effect.fnUntraced(function* (
  organizationId: string,
  email: string,
) {
  const apiKeys = yield* ApiKeys
  const key = yield* apiKeys.defaultKey(organizationId)
  if (!key) {
    return yield* (yield* apiKeys.hasAny(organizationId))
      ? new OrganizationApiKeyUnavailable()
      : new OrganizationApiKeysMissing()
  }
  const token = yield* Effect.tryPromise(() =>
    new SignJWT({ ver: 1, email, organization_id: organizationId })
      .setProtectedHeader({
        alg: "HS256",
        typ: ORGANIZATION_TOKEN_TYPE,
        kid: formatApiKeyId({ organizationId, id: key.id }),
      })
      .setIssuer(organizationId)
      .setAudience(APP_HANDLE)
      .setIssuedAt()
      .setExpirationTime("5m")
      // The stored digest is the verifier used by organization-issued JWTs, not the raw API key.
      .sign(new TextEncoder().encode(key.digest)),
  ).pipe(Effect.orDie)
  return { token }
})
