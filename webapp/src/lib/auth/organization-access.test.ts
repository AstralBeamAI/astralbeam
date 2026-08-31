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

async function createAuthorizationFixture() {
  const instance = await getTestInstance({
    plugins: [
      organization({
        ac: organizationAccessControl,
        roles: organizationRoles,
      }),
      apiKey({
        configId: "organization",
        defaultPrefix: ORGANIZATION_API_KEY_PREFIX,
        rateLimit: {
          maxRequests: ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
          timeWindow: ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
        },
        references: "organization",
        requireName: true,
      }),
    ],
  })
  const owner = await instance.signInWithTestUser()
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
    headers,
    organizationId: createdOrganization.id,
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
          configId: "organization",
          organizationId: fixture.organizationId,
          name: `${role} key`,
        },
        headers: fixture.headers[role],
      })

      const listed = await fixture.auth.api.listApiKeys({
        query: {
          configId: "organization",
          organizationId: fixture.organizationId,
        },
        headers: fixture.headers[role],
      })

      expect(created.referenceId).toBe(fixture.organizationId)
      expect(listed.apiKeys).toContainEqual(expect.objectContaining({ id: created.id }))
    },
  )

  test("rejects viewer access at every API key management endpoint", async () => {
    const existing = await fixture.auth.api.createApiKey({
      body: {
        configId: "organization",
        organizationId: fixture.organizationId,
        name: "Owner key",
      },
      headers: fixture.headers.owner,
    })
    const denied = {
      status: "FORBIDDEN",
      body: expect.objectContaining({
        code: API_KEY_ERROR_CODES.INSUFFICIENT_API_KEY_PERMISSIONS.code,
      }),
    }

    await expect(fixture.auth.api.createApiKey({
      body: {
        configId: "organization",
        organizationId: fixture.organizationId,
        name: "Viewer key",
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.listApiKeys({
      query: {
        configId: "organization",
        organizationId: fixture.organizationId,
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.updateApiKey({
      body: {
        configId: "organization",
        keyId: existing.id,
        name: "Viewer renamed key",
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
    await expect(fixture.auth.api.deleteApiKey({
      body: {
        configId: "organization",
        keyId: existing.id,
      },
      headers: fixture.headers.viewer,
    })).rejects.toMatchObject(denied)
  })
})
