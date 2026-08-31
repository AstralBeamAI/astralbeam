import { createHash } from "node:crypto"

import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware, freshSessionMiddleware } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

import { runDatabaseEffect } from "@/db"
import { databaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { organizationRoles } from "./organization-access.ts"
import {
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "./organization-api-key-configuration.ts"

const ORGANIZATION_API_KEY_RATE_LIMIT_KEY_PREFIX = "organization-api-key:"

export const organizationApiKeyFreshSessionPlugin = {
  id: "organization-api-key-fresh-session",
  hooks: {
    before: [{
      matcher: (context) => context.path === "/api-key/create",
      handler: createAuthMiddleware(async (context) => {
        await freshSessionMiddleware(
          context as Parameters<typeof freshSessionMiddleware>[0],
        )
      }),
    }],
  },
} satisfies BetterAuthPlugin

export async function validateOrganizationApiKeyRateLimit({ key }: { key: string }) {
  const keyDigest = createHash("sha256").update(key).digest("base64url")
  const result = await runDatabaseEffect(
    databaseRateLimiter.consume({
      key: `${ORGANIZATION_API_KEY_RATE_LIMIT_KEY_PREFIX}${keyDigest}`,
      limit: ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
      window: Duration.millis(ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS),
    }).pipe(Effect.result),
  )

  if (result._tag === "Success") return true
  if (result.failure.reason._tag === "RateLimitExceeded") {
    throw new APIError("TOO_MANY_REQUESTS", {
      code: "RATE_LIMITED",
      message: "API key rate limit exceeded",
      details: {
        tryAgainIn: Math.ceil(Duration.toMillis(result.failure.reason.retryAfter)),
      },
    })
  }

  throw new APIError("INTERNAL_SERVER_ERROR", {
    code: "API_KEY_RATE_LIMIT_UNAVAILABLE",
    message: "API key validation is temporarily unavailable",
  })
}

function assertConfiguredOrganizationRoles(role: string): void {
  const roles = role.split(",")
  if (
    roles.some((value) =>
      value.length === 0 || value !== value.trim() || !Object.hasOwn(organizationRoles, value)
    ) || new Set(roles).size !== roles.length
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_ORGANIZATION_ROLE",
      message: "Organization role is not supported",
    })
  }
}

export const organizationRoleHooks = {
  beforeAddMember: ({ member }) => {
    assertConfiguredOrganizationRoles(member.role)
    return Promise.resolve()
  },
  beforeUpdateMemberRole: ({ newRole }) => {
    assertConfiguredOrganizationRoles(newRole)
    return Promise.resolve()
  },
  beforeCreateInvitation: ({ invitation }) => {
    assertConfiguredOrganizationRoles(invitation.role)
    return Promise.resolve()
  },
  beforeAcceptInvitation: ({ invitation }) => {
    assertConfiguredOrganizationRoles(invitation.role)
    return Promise.resolve()
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>
