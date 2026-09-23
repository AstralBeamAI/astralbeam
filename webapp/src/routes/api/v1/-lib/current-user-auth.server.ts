import { createHash } from "node:crypto"
import { Effect } from "effect"
import { decodeProtectedHeader } from "jose"
import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { syncTenantCurrentUser } from "@/db/current-user.server"
import { authenticateChatRequest, isChatAuthenticationError } from "@/lib/chat/auth.server"
import { CHAT_AUTH_TOKEN_TYPE } from "@/lib/chat/constants.server"
import {
  authenticateOrganizationRequest,
  ORGANIZATION_TOKEN_TYPE,
} from "@/lib/organization-token.server"
import { restFault, restRateLimitFault } from "./responses.server"

function currentUserRateLimit(identity: readonly string[]) {
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("base64url")
  return databaseRateLimiter
    .consume({
      key: `current-user:${key}`,
      limit: 100,
      window: "5 minutes",
    })
    .pipe(Effect.mapError(restRateLimitFault))
}

export function getCurrentUser(request: Request) {
  return Effect.gen(function* () {
    const typ = yield* Effect.try({
      try: () => {
        const token = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
        if (!token || token.length > 16384 || request.headers.has("x-api-key")) throw new Error()
        return decodeProtectedHeader(token).typ
      },
      catch: () => restFault(401, "Invalid credentials."),
    })
    if (typ === ORGANIZATION_TOKEN_TYPE) {
      const principal = yield* authenticateOrganizationRequest(request).pipe(
        Effect.catchTag("OrganizationMembershipError", () =>
          Effect.fail(restFault(403, "Organization membership is required.")),
        ),
      )
      yield* currentUserRateLimit([
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
    if (typ !== CHAT_AUTH_TOKEN_TYPE) {
      return yield* Effect.fail(restFault(401, "Invalid credentials."))
    }
    const principal = yield* Effect.tryPromise({
      try: () => authenticateChatRequest(request),
      catch: (error) => error,
    })
    yield* currentUserRateLimit([
      "tenant",
      principal.organization.id,
      principal.tenantUser.tenant.id,
      principal.tenantUser.id,
    ])
    const records = yield* syncTenantCurrentUser(principal)
    return { scope: "tenant" as const, organization: principal.organization, ...records }
  }).pipe(
    Effect.catchIf(isChatAuthenticationError, () =>
      Effect.fail(restFault(401, "Invalid credentials.")),
    ),
  )
}
