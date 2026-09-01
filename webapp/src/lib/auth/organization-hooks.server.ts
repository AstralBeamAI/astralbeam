import type { BetterAuthPlugin } from "better-auth"
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
        if (parseOrganizationApiKeyPrefix(prefix) === null) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_API_KEY_SLUG",
            message: "API key identifier is invalid",
          })
        }
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
          // PostgreSQL's insert trigger supplies this value atomically; keeping the companion
          // field optional lets non-PostgreSQL Better Auth test adapters exercise the route.
          required: false,
          input: false,
          returned: true,
        },
      },
    },
  },
} satisfies BetterAuthPlugin

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
