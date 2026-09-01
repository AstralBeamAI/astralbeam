import { API_KEY_TABLE_NAME } from "@better-auth/api-key"
import type { BetterAuthPlugin, DBAdapterInstance } from "better-auth"
import { APIError, createAuthMiddleware, freshSessionMiddleware } from "better-auth/api"
import type { OrganizationOptions } from "better-auth/plugins"
import { isValidSlug } from "@/lib/slug"
import { organizationRoles } from "./organization-access.ts"
import { parseOrganizationApiKeyPrefix } from "./organization-api-key-configuration.ts"

export const organizationApiKeyPlugin = {
  id: "organization-api-key",
  hooks: {
    before: [{
      matcher: (context) => context.path === "/api-key/create",
      handler: createAuthMiddleware(async (context) => {
        const body: unknown = context.body
        const prefix = body && typeof body === "object" && "prefix" in body
          ? body.prefix
          : undefined
        requireOrganizationApiKeySlug(prefix)
        await freshSessionMiddleware(
          context as Parameters<typeof freshSessionMiddleware>[0],
        )
      }),
    }],
  },
  schema: {
    apikey: {
      modelName: "apiKey",
      fields: {
        slug: {
          type: "string",
          required: false,
          input: false,
          returned: true,
        },
      },
    },
  },
} satisfies BetterAuthPlugin

// Better Auth's API-key create route writes through the raw adapter, bypassing database hooks.
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/api-key/src/routes/create-api-key.ts
export function withOrganizationApiKeySlug(adapterFactory: DBAdapterInstance): DBAdapterInstance {
  return (options) => {
    const adapter = adapterFactory(options)
    return {
      ...adapter,
      create: <T extends Record<string, unknown>>(input: {
        model: string
        data: T
        select?: string[] | undefined
      }) =>
        adapter.create({
          ...input,
          data: input.model === API_KEY_TABLE_NAME
            ? { ...input.data, slug: requireOrganizationApiKeySlug(input.data.prefix) }
            : input.data,
        }),
    }
  }
}

function requireOrganizationApiKeySlug(prefix: unknown): string {
  const slug = parseOrganizationApiKeyPrefix(prefix)
  if (slug === null) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_API_KEY_SLUG",
      message: "API key identifier is invalid",
    })
  }
  return slug
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
  beforeCreateOrganization: ({ organization }) => {
    assertOrganizationSlug(organization.slug)
    return Promise.resolve()
  },
  beforeUpdateOrganization: ({ organization }) => {
    if (Object.hasOwn(organization, "slug")) {
      throw new APIError("BAD_REQUEST", {
        code: "ORGANIZATION_SLUG_IMMUTABLE",
        message: "Organization slug cannot be changed",
      })
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

function assertOrganizationSlug(value: unknown): asserts value is string {
  if (typeof value !== "string" || !isValidSlug(value)) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_ORGANIZATION_SLUG",
      message: "Organization slug must contain only lowercase letters and numbers",
    })
  }
}
