import { createAstralBeamToken } from "@astralbeam/sdk/server"
import * as Effect from "effect/Effect"
import { SignJWT } from "jose"

import { readOrganizationMembership } from "@/db/organization.server"
import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import {
  hasOrganizationApiKeys,
  readOrganizationDefaultApiKey,
} from "@/db/organization-configuration.server"
import { upsertDogfoodIdentity } from "@/db/dogfood.server"
import { getAuth } from "@/lib/auth.server"
import { getGlobalConfig } from "@/lib/config"
import { APP_HANDLE } from "@/lib/constants"
import { ORGANIZATION_TOKEN_TYPE } from "@/lib/organization-token.server"
import { authorizeOrganizationRole } from "./organization-access"

function dashboardTokenFailure(
  status: 401 | 403 | 404 | 429 | 503,
  message: string,
  code?: "NO_API_KEYS",
) {
  return { _tag: "DashboardTokenError" as const, status, message, code }
}

export function issueDashboardToken(input: {
  organizationSlug: string
  headers: Headers
  scope?: "organization" | undefined
}) {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: async () => (await getAuth()).api.getSession({ headers: input.headers }),
      catch: () => dashboardTokenFailure(503, "Authentication is unavailable"),
    })
    if (!session) return yield* Effect.fail(dashboardTokenFailure(401, "Authentication required"))
    yield* databaseRateLimiter.consume({
      key: `dashboard-token:${session.user.id}`,
      limit: 60,
      window: "1 minute",
    }).pipe(
      Effect.mapError((error) =>
        error.reason._tag === "RateLimitExceeded"
          ? dashboardTokenFailure(429, "Too many token requests. Please try again in a minute.")
          : dashboardTokenFailure(503, "Authentication is unavailable")
      ),
    )
    const organization = yield* readOrganizationMembership({
      organizationSlug: input.organizationSlug,
      userId: session.user.id,
    })
    if (!organization) {
      return yield* Effect.fail(dashboardTokenFailure(404, "Organization is unavailable"))
    }
    if (input.scope === "organization") {
      if (!authorizeOrganizationRole(organization.role, { tenantManagement: ["read"] })) {
        return yield* Effect.fail(dashboardTokenFailure(403, "Tenant access is not permitted"))
      }
      return yield* issueDashboardOrganizationToken(organization.organizationId, session.user.email)
    }
    const [organizationId, apiKey] = yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          getGlobalConfig("dogfood_organization_id"),
          getGlobalConfig("dogfood_api_key"),
        ]),
      catch: () => dashboardTokenFailure(503, "Embedded assistant is unavailable"),
    })
    if (!organizationId || !apiKey?.startsWith(`key_${organizationId}_`)) {
      return yield* Effect.fail(dashboardTokenFailure(503, "Embedded assistant is unavailable"))
    }
    const tenant = {
      id: organization.organizationId,
      name: organization.organizationName,
      metadata: { slug: organization.organizationSlug },
    }
    const user = {
      id: session.user.id,
      name: session.user.name,
      admin: false,
      metadata: { email: session.user.email },
    }
    const token = yield* Effect.tryPromise({
      try: () => createAstralBeamToken({ apiKey, tenant, user }),
      catch: () => dashboardTokenFailure(503, "Embedded assistant is unavailable"),
    })
    yield* upsertDogfoodIdentity({ organizationId, tenant, user })
    return { token }
  })
}

function issueDashboardOrganizationToken(organizationId: string, email: string) {
  return Effect.gen(function* () {
    const key = yield* readOrganizationDefaultApiKey(organizationId)
    if (!key) {
      return yield* Effect.fail(
        dashboardTokenFailure(
          503,
          "Create an enabled, unexpired API key for this Organization.",
          (yield* hasOrganizationApiKeys(organizationId)) ? undefined : "NO_API_KEYS",
        ),
      )
    }
    const token = yield* Effect.tryPromise({
      try: () =>
        new SignJWT({ ver: 1, email, organization_id: organizationId })
          .setProtectedHeader({
            alg: "HS256",
            typ: ORGANIZATION_TOKEN_TYPE,
            kid: `key_${organizationId}_${key.id}`,
          })
          .setIssuer(organizationId)
          .setAudience(APP_HANDLE)
          .setIssuedAt()
          .setExpirationTime("5m")
          // The stored digest is the verifier used by organization-issued JWTs, not the raw API key.
          .sign(new TextEncoder().encode(key.key)),
      catch: () => dashboardTokenFailure(503, "Organization token could not be issued"),
    })
    return { token }
  })
}
