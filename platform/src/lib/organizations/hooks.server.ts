import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware, freshSessionMiddleware } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { Config, ConfigProvider, Effect, Schema } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { SLUG_VALIDATION_MESSAGE, SlugSchema } from "@/lib/organizations/slug"
import { isValidOpenaiApiKey } from "./schemas.ts"
import { IS_DEVELOPMENT_SERVER } from "@/lib/runtime/environment.server"
import { organizationRoles } from "./access.ts"
import { ORGANIZATION_API_KEY_PREFIX } from "../api-keys/schemas.ts"
import { isReservedOrganizationSlug, RESERVED_ORGANIZATION_SLUG_MESSAGE } from "./reserved-slugs.ts"

const isOrganizationSlug = Schema.is(SlugSchema)

export const organizationApiKeyPlugin = {
  id: "organization-api-key",
  hooks: {
    before: [
      {
        matcher: (context) => context.path === "/api-key/create",
        handler: createAuthMiddleware(async (context) => {
          await freshSessionMiddleware(context as Parameters<typeof freshSessionMiddleware>[0])
          const body = context.body as { prefix?: unknown } | undefined
          if (body?.prefix !== undefined && body.prefix !== ORGANIZATION_API_KEY_PREFIX) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_API_KEY_PREFIX",
              message: "API key prefix is invalid",
            })
          }
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin

function assertConfiguredOrganizationRoles(role: string): void {
  const roles = role.split(",")
  if (
    roles.some(
      (value) =>
        value.length === 0 || value !== value.trim() || !Object.hasOwn(organizationRoles, value),
    ) ||
    new Set(roles).size !== roles.length
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_ORGANIZATION_ROLE",
      message: "Organization role is not supported",
    })
  }
}

export const organizationRoleHooks = {
  beforeCreateOrganization: ({ organization }) => {
    assertOrganizationSlug(organization.slug)
    return Promise.resolve()
  },
  beforeUpdateOrganization: ({ organization }) => {
    if (Object.hasOwn(organization, "slug")) {
      assertOrganizationSlug(organization.slug)
    }
    return Promise.resolve()
  },
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

/**
 * Kept apart from the validation hooks above, which stay usable without a database, so a new
 * organization can be chatted with before anyone opens the dashboard.
 */
export const organizationProvisioningHooks = {
  afterCreateOrganization: async ({ organization }) => {
    await runAppEffect(
      Effect.gen(function* () {
        // Read afresh, as the Config service rereads the environment it overrides.
        const openaiApiKey = IS_DEVELOPMENT_SERVER
          ? (yield* Config.String("OPENAI_API_KEY").pipe(
              Config.withDefault(""),
              Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv()),
            )).trim()
          : undefined
        const agents = yield* Agents
        yield* agents.provisionDefault({
          organizationId: organization.id,
          organizationName: organization.name,
          openaiApiKey: isValidOpenaiApiKey(openaiApiKey) ? openaiApiKey : undefined,
        })
      }).pipe(
        // The organization already exists and its owner can add an agent by hand, so a failure
        // here must not fail the request that created it.
        Effect.catchCause((cause) => reportFailure("afterCreateOrganization", cause)),
      ),
    )
  },
} satisfies NonNullable<OrganizationOptions["organizationHooks"]>

function assertOrganizationSlug(value: unknown): asserts value is string {
  if (!isOrganizationSlug(value)) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_ORGANIZATION_SLUG",
      message: SLUG_VALIDATION_MESSAGE,
    })
  }
  if (isReservedOrganizationSlug(value)) {
    throw new APIError("BAD_REQUEST", {
      code: "RESERVED_ORGANIZATION_SLUG",
      message: RESERVED_ORGANIZATION_SLUG_MESSAGE,
    })
  }
}
