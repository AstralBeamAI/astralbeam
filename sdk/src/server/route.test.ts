import { describe, expect, it } from "vitest"
import { createAstralBeamTokenRoute } from "./index.ts"

const apiKey = `key_analyticalengines_production_abo_${"aB".repeat(32)}`
const tenantUser = { id: "tenant-user-1", tenant: { id: "tenant-1" } }

function post(): Request {
  return new Request("https://app.example/api/astralbeam/token", { method: "POST" })
}

describe("createAstralBeamTokenRoute", () => {
  it("mints a token with no-store for an authenticated request", async () => {
    const route = createAstralBeamTokenRoute({ apiKey, tenantUser: () => tenantUser })
    const response = await route(post())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = await response.json() as { token: string }
    // Three dot-separated base64url segments: enough to prove a JWT without re-verifying it here.
    expect(body.token.split(".")).toHaveLength(3)
  })

  it("rejects non-POST methods", async () => {
    const route = createAstralBeamTokenRoute({ apiKey, tenantUser: () => tenantUser })
    const response = await route(new Request("https://app.example/token", { method: "GET" }))
    expect(response.status).toBe(405)
  })

  it("answers 503 when the API key is not configured", async () => {
    const route = createAstralBeamTokenRoute({
      apiKey: () => undefined,
      tenantUser: () => tenantUser,
    })
    const response = await route(post())
    expect(response.status).toBe(503)
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("answers 401 when the session callback returns nothing or throws", async () => {
    const returning = createAstralBeamTokenRoute({ apiKey, tenantUser: () => undefined })
    expect((await returning(post())).status).toBe(401)
    const throwing = createAstralBeamTokenRoute({
      apiKey,
      tenantUser: () => {
        throw new Error("no session")
      },
    })
    expect((await throwing(post())).status).toBe(401)
  })

  it("answers 500 without leaking the reason when minting fails", async () => {
    const route = createAstralBeamTokenRoute({
      apiKey: "not-a-real-key",
      tenantUser: () => tenantUser,
    })
    const response = await route(post())
    expect(response.status).toBe(500)
    const body = await response.json() as { error: string }
    // The thrown message describes the key's expected shape; the client must not see it.
    expect(body.error).not.toMatch(/abo_/)
  })
})
