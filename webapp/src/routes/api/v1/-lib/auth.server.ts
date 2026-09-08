import { and, eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import { Duration, Effect } from "effect"
import { type EffectDatabase, effectDatabase } from "@/db"
import { apiKey, organization } from "@/db/schema/organizations.server"
import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { resolveTenant, type TenantError } from "@/db/tenant.server"
import { getAuth } from "@/lib/auth.server"
import {
  authenticateChatRequest,
  isChatAuthenticationError,
} from "@/routes/api/chat/-lib/auth.server"
import type { RestScope } from "./contract.server"
import { type RestFault, restFault } from "./responses.server"

export function authenticateRestRequest(
  request: Request,
): Effect.Effect<RestScope, RestFault | TenantError, EffectDatabase> {
  return Effect.gen(function* () {
    const apiKeyHeader = request.headers.get("x-api-key")
    const authorization = request.headers.get("authorization")
    const credential = apiKeyHeader ?? /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1]
    if (!credential || credential.length > 16384) {
      return yield* Effect.fail(restFault(401, "Invalid credentials."))
    }
    if (apiKeyHeader !== null || credential.startsWith("key_")) {
      return yield* authenticateRestApiKey(credential)
    }
    const principal = yield* Effect.tryPromise({
      try: () => authenticateChatRequest(request),
      catch: (error) =>
        isChatAuthenticationError(error)
          ? restFault(401, "Invalid credentials.")
          : restFault(500, "Authentication could not be completed."),
    })
    if (principal.tenantUser.admin !== true) {
      return yield* Effect.fail(restFault(403, "Tenant administrator authority is required."))
    }
    const organizationId = principal.organization.id
    const externalTenantId = principal.tenantUser.tenant.id
    const identity = createHash("sha256").update(
      JSON.stringify([organizationId, externalTenantId, principal.tenantUser.id]),
    ).digest("base64url")
    yield* databaseRateLimiter.consume({
      key: `tenant-rest:${identity}`,
      limit: 100,
      window: Duration.minutes(5),
    }).pipe(
      Effect.mapError((error) =>
        error.reason._tag === "RateLimitExceeded"
          ? restFault(429, "Request limit exceeded.", {
            retryAfter: Math.max(1, Math.ceil(Duration.toMillis(error.reason.retryAfter) / 1000)),
          })
          : restFault(500, "Request limit could not be checked.")
      ),
    )
    const tenantId = yield* resolveTenant(organizationId, externalTenantId)
    return { organizationId, tenantId, externalTenantId } satisfies RestScope
  })
}
function authenticateRestApiKey(credential: string) {
  return Effect.gen(function* () {
    const parts = /^key_([a-z0-9-]{1,63})_([a-z0-9-]{1,63})_(abo_[A-Za-z]{64})$/.exec(credential)
    if (!parts) return yield* Effect.fail(restFault(401, "Invalid credentials."))
    const verified = yield* Effect.tryPromise({
      try: async () => (await getAuth()).api.verifyApiKey({ body: { key: parts[3]! } }),
      catch: () => restFault(500, "Authentication could not be completed."),
    })
    if (!verified.valid || !verified.key) {
      if (verified.error?.code === "RATE_LIMITED") {
        const details = verified.error as { details?: { tryAgainIn?: unknown } }
        const milliseconds = details.details?.tryAgainIn
        return yield* Effect.fail(
          restFault(429, "Request limit exceeded.", {
            retryAfter: typeof milliseconds === "number" && Number.isFinite(milliseconds)
              ? Math.max(1, Math.ceil(milliseconds / 1000))
              : 300,
          }),
        )
      }
      return yield* Effect.fail(restFault(401, "Invalid credentials."))
    }
    const database = yield* effectDatabase
    const rows = yield* database.select({ id: organization.id }).from(organization).innerJoin(
      apiKey,
      eq(apiKey.organizationId, organization.id),
    ).where(and(
      eq(organization.id, verified.key.referenceId),
      eq(organization.slug, parts[1]!),
      eq(apiKey.id, verified.key.id),
      eq(apiKey.slug, parts[2]!),
      eq(apiKey.configId, "default"),
    )).limit(1).pipe(
      Effect.mapError(() => restFault(500, "Authentication could not be completed.")),
    )
    if (!rows[0]) return yield* Effect.fail(restFault(401, "Invalid credentials."))
    return { organizationId: rows[0].id } satisfies RestScope
  })
}
