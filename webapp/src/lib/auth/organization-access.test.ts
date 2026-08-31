import { createHash } from "node:crypto"

import { API_KEY_ERROR_CODES, apiKey } from "@better-auth/api-key"
import { organization } from "better-auth/plugins"
import { getTestInstance } from "better-auth/test"
import { beforeAll, describe, expect, test } from "vitest"

import {
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
} from "./organization-api-key-configuration.ts"
import { organizationAccessControl, organizationRoles } from "./organization-access.ts"
import { organizationApiKeyFreshSessionPlugin } from "./organization-hooks.server.ts"

async function createAuthorizationFixture() {
  const instance = await getTestInstance({
    plugins: [
      organization({
        ac: organizationAccessControl,
        roles: organizationRoles,
      }),
      organizationApiKeyFreshSessionPlugin,
      apiKey({
        defaultPrefix: ORGANIZATION_API_KEY_PREFIX,
        rateLimit: {
          enabled: false,
          maxRequests: ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
          timeWindow: ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
        },
        references: "organization",
        requireName: true,
      }),
    ],
  })
  const owner = await instance.signInWithTestUser()
  const ownerSession = await instance.auth.api.getSession({ headers: owner.headers })
  const createdOrganization = await instance.auth.api.createOrganization({
    body: {
      name: "Authorization Boundary",
      slug: "authorization-boundary",
    },
    headers: owner.headers,
  })

  const headers = { owner: owner.headers } as Record<keyof typeof organizationRoles, Headers>
  for (const role of ["developer", "viewer"] as const) {
    const password = "authorization-test-password"
    const signUp = await instance.auth.api.signUpEmail({
      body: {
        email: `${role}@example.test`,
        name: role,
        password,
      },
    })
    await instance.db.create({
      model: "member",
      data: {
        userId: signUp.user.id,
        organizationId: createdOrganization.id,
        role,
        createdAt: new Date(),
      },
    })
    headers[role] = (await instance.signInWithUser(signUp.user.email, password)).headers
  }

  return {
    auth: instance.auth,
    db: instance.db,
    headers,
    organizationId: createdOrganization.id,
    ownerSessionToken: ownerSession!.session.token,
  }
}

describe("organization API key authorization", () => {
  let fixture: Awaited<ReturnType<typeof createAuthorizationFixture>>

  beforeAll(async () => {
    fixture = await createAuthorizationFixture()
  })

  test.each(["owner", "developer"] as const)(
    "allows %s members through the API key management endpoints",
    async (role) => {
      const created = await fixture.auth.api.createApiKey({
        body: {
          organizationId: fixture.organizationId,
          name: `${role} key`,
        },
        headers: fixture.headers[role],
      })

      const listed = await fixture.auth.api.listApiKeys({
        query: {
          organizationId: fixture.organizationId,
        },
        headers: fixture.headers[role],
      })

      expect(created.referenceId).toBe(fixture.organizationId)
      expect(created).toMatchObject({
        rateLimitEnabled: false,
        rateLimitMax: ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
        rateLimitTimeWindow: ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
      })
      expect(listed.apiKeys).toContainEqual(expect.objectContaining({ id: created.id }))
    },
  )

  test("keeps rate limits server-owned on create and update", async () => {
    const serverOnlyRateLimit = {
      rateLimitEnabled: false,
      rateLimitMax: 1,
      rateLimitTimeWindow: 1,
    }
    const denied = {
      status: "BAD_REQUEST",
      body: { code: API_KEY_ERROR_CODES.SERVER_ONLY_PROPERTY.code },
    }

    await expect(fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Custom rate limit",
        ...serverOnlyRateLimit,
      },
      headers: fixture.headers.owner,
    })).rejects.toMatchObject(denied)

    const existing = await fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Fixed rate limit",
      },
      headers: fixture.headers.owner,
    })
    await expect(fixture.auth.api.updateApiKey({
      body: {
        keyId: existing.id,
        ...serverOnlyRateLimit,
      },
      headers: fixture.headers.owner,
    })).rejects.toMatchObject(denied)
  })

  test("rejects viewer access at every API key management endpoint", async () => {
    const existing = await fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Owner key",
      },
      headers: fixture.headers.owner,
    })
    const denied = {
      status: "FORBIDDEN",
      body: { code: API_KEY_ERROR_CODES.INSUFFICIENT_API_KEY_PERMISSIONS.code },
    }

    await expect(fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Viewer key",
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.listApiKeys({
      query: {
        organizationId: fixture.organizationId,
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.updateApiKey({
      body: {
        keyId: existing.id,
        name: "Viewer renamed key",
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.deleteApiKey({
      body: {
        keyId: existing.id,
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
  })

  test("stores only the API key digest", async () => {
    const created = await fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Hashed key",
      },
      headers: fixture.headers.owner,
    })
    const stored = await fixture.db.findOne<{ id: string; key: string }>({
      model: "apikey",
      where: [{ field: "id", value: created.id }],
    })

    expect(created.key).toMatch(/^abo_/)
    expect(stored?.key).toBe(createHash("sha256").update(created.key).digest("base64url"))
    await expect(fixture.auth.api.verifyApiKey({
      body: { key: created.key },
    })).resolves.toMatchObject({ valid: true, key: { id: created.id } })
    await expect(fixture.auth.api.verifyApiKey({
      body: { key: stored!.key },
    })).resolves.toMatchObject({ valid: false, key: null })
  })

  test("requires a fresh session to create an organization API key", async () => {
    await fixture.db.update({
      model: "session",
      where: [{ field: "token", value: fixture.ownerSessionToken }],
      update: { createdAt: new Date(0) },
    })

    await expect(fixture.auth.api.createApiKey({
      body: {
        organizationId: fixture.organizationId,
        name: "Stale session key",
      },
      headers: fixture.headers.owner,
    })).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { code: "SESSION_NOT_FRESH" },
    })
  })
})
