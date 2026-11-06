import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware, freshSessionMiddleware } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { type Cause, Effect, Schema } from "effect"

import { Agents } from "@/lib/agents/agents.server"
import { Config } from "@/lib/config/config"
import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import type { UsageLimitFields } from "@/lib/usage-limits/schemas"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { SLUG_VALIDATION_MESSAGE, SlugSchema } from "@/lib/organizations/slug"
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
          await freshSessionMiddleware(context)
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

/** The model each new organization's starter agent uses through the deployment's OpenAI key. */
const STARTER_MODEL = { modelId: "gpt-6.1-terra", name: "GPT-6.1 Terra" } as const

const STARTER_USAGE_LIMIT = {
  name: "Monthly spend",
  enabled: true,
  appliesByDefault: true,
  scope: "global",
  metric: "spend",
  amount: "10",
  windowType: "fixed",
  windowCount: 1,
  windowUnit: "month",
  timeZone: "UTC",
} as const satisfies UsageLimitFields

/** Connects OpenAI with the deployment's default key and returns the enabled model's ID. */
const provisionStarterModel = Effect.fn("provisionStarterModel")(function* (
  organizationId: string,
) {
  const apiKey = yield* Effect.flatMap(Config, (config) => config.get("default_openai_api_key"))
  if (!apiKey) return yield* Effect.die(new Error("The default OpenAI API key is not configured"))
  const modelProviders = yield* ModelProviders
  const id = yield* modelProviders.save({
    organizationId,
    id: null,
    lockVersion: null,
    name: "OpenAI",
    providerType: "openai",
    api: "responses",
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    models: [STARTER_MODEL],
  })
  const provider = yield* modelProviders.get({ organizationId, id })
  return provider!.models[0]!.id
})

/**
 * Kept apart from the validation hooks above, which stay usable without a database, so a new
 * organization starts with an agent that replies through the deployment's OpenAI key, capped by a
 * monthly spend limit its owner can change.
 */
export const organizationProvisioningHooks = {
  afterCreateOrganization: async ({ organization }) => {
    // The organization already exists and its owner can finish setup by hand, so a failure here
    // must not fail the request that created it.
    const report = (cause: Cause.Cause<unknown>) => reportFailure("afterCreateOrganization", cause)
    await runAppEffect(
      Effect.gen(function* () {
        // The shared key is connected only after its spend limit exists. Without a model the agent
        // is still created, and the dashboard asks for one.
        const limited = yield* Effect.flatMap(UsageLimits, (usageLimits) =>
          usageLimits.create({ organizationId: organization.id, fields: STARTER_USAGE_LIMIT }),
        ).pipe(
          Effect.as(true),
          Effect.catchCause((cause) => Effect.as(report(cause), false)),
        )
        const modelId = limited
          ? yield* provisionStarterModel(organization.id).pipe(
              Effect.catchCause((cause) => Effect.as(report(cause), null)),
            )
          : null
        yield* Effect.flatMap(Agents, (agents) =>
          agents.provisionDefault({
            organizationId: organization.id,
            organizationName: organization.name,
            modelIds: modelId ? [modelId] : [],
          }),
        )
      }).pipe(Effect.catchCause(report)),
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
