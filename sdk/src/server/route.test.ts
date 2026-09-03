import { describe, expect, it } from "vitest"
import { createAstralBeamTokenRoute } from "./index.ts"

const apiKey = `key_analyticalengines_production_abo_${"aB".repeat(32)}`
const user = { id: "tenant-user-1" }
const tenant = { id: "tenant-1" }

interface ApplicationTenantMetadata {
  plan: string
}

interface ApplicationTenant {
  id: string
  metadata: ApplicationTenantMetadata
}

interface ApplicationTenantUserMetadata {
  roles: string[]
}

interface ApplicationTenantUser {
  id: string
  metadata: ApplicationTenantUserMetadata
}

interface ApplicationSession {
  user: ApplicationTenantUser
  tenant: ApplicationTenant
}

const session = { user, tenant }
const routeOptions = {
  apiKey,
  authenticate: () => session,
  user: (authenticated: typeof session) => authenticated.user,
  tenant: (authenticated: typeof session) => authenticated.tenant,
}

function post(): Request {
  return new Request("https://app.example/api/astralbeam/token", { method: "POST" })
}

describe("createAstralBeamTokenRoute", () => {
  it("accepts named application interfaces with JSON metadata", async () => {
    const applicationUser: ApplicationTenantUser = {
      id: "tenant-user-1",
      metadata: { roles: ["owner"] },
    }
    const applicationTenant: ApplicationTenant = {
      id: "tenant-1",
      metadata: { plan: "enterprise" },
    }
    const applicationSession: ApplicationSession = {
      user: applicationUser,
      tenant: applicationTenant,
    }
    const route = createAstralBeamTokenRoute({
      apiKey,
      authenticate: () => applicationSession,
      user: (authenticated) => authenticated.user,
      tenant: (authenticated) => authenticated.tenant,
    })

    expect((await route(post())).status).toBe(200)
  })

  it("mints a token with no-store for an authenticated request", async () => {
    const route = createAstralBeamTokenRoute(routeOptions)
    const response = await route(post())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json() as { token: string }
    // Three dot-separated base64url segments: enough to prove a JWT without re-verifying it here.
    expect(body.token.split(".")).toHaveLength(3)
  })

  it("rejects non-POST methods", async () => {
    const route = createAstralBeamTokenRoute(routeOptions)
    const response = await route(new Request("https://app.example/token", { method: "GET" }))
    expect(response.status).toBe(405)
  })

  it("answers 503 when the API key is not configured", async () => {
    const route = createAstralBeamTokenRoute({
      ...routeOptions,
      apiKey: () => undefined,
    })
    const response = await route(post())
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("answers 401 when session authentication returns nothing or throws", async () => {
    const returning = createAstralBeamTokenRoute({
      ...routeOptions,
      authenticate: () => undefined,
    })
    expect((await returning(post())).status).toBe(401)
    const throwing = createAstralBeamTokenRoute({
      ...routeOptions,
      authenticate: () => {
        throw new Error("no session")
      },
    })
    expect((await throwing(post())).status).toBe(401)
  })

  it("answers 500 without leaking the reason when minting fails", async () => {
    const route = createAstralBeamTokenRoute({
      ...routeOptions,
      apiKey: "not-a-real-key",
    })
    const response = await route(post())
    expect(response.status).toBe(500)
    const body = await response.json() as { error: string }
    // The thrown message describes the key's expected shape; the client must not see it.
    expect(body.error).not.toMatch(/abo_/)
  })
})
