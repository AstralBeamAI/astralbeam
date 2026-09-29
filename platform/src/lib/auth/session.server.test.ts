import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"

import { ServerRequest } from "@/lib/runtime/server-request.server"
import { type AppAuth, Auth, type AuthSession } from "./auth.server.ts"
import { resolveSessionAccess } from "./session.server.ts"

function sessionAccessLayer(session: AuthSession | null) {
  const recorded = { headers: [] as Record<string, string>[], listed: 0 }
  const organizations = [{ id: "organization-a", slug: "organizationa" }]
  const auth = Layer.succeed(Auth, {
    getSession: () => Effect.succeed(session),
    api: (call: (api: AppAuth["api"]) => Promise<unknown>) =>
      Effect.promise(() =>
        call({
          listOrganizations: () => {
            recorded.listed += 1
            return Promise.resolve(organizations)
          },
        } as unknown as AppAuth["api"]),
      ),
  } as unknown as Context.Service.Shape<typeof Auth>)
  const request = Layer.succeed(ServerRequest, {
    request: new Request("https://app.example.test/"),
    setHeaders: (headers: Record<string, string>) =>
      Effect.sync(() => void recorded.headers.push(headers)),
  } as unknown as ServerRequest["Service"])
  return { recorded, layer: Layer.merge(auth, request) }
}

describe("session access", () => {
  it.effect("marks the decision private and reads no memberships for a signed-out request", () => {
    const { recorded, layer } = sessionAccessLayer(null)
    return Effect.gen(function* () {
      const result = yield* resolveSessionAccess()
      assert.deepStrictEqual(result.access, { status: "signed-out" })
      assert.deepStrictEqual(recorded.headers, [
        { "Cache-Control": "no-store", Vary: "Cookie, Authorization" },
      ])
      assert.strictEqual(recorded.listed, 0)
    }).pipe(Effect.provide(layer))
  })

  it.effect("returns the memberships it decided from, which routing seeds into queries", () => {
    const session = {
      session: { activeOrganizationId: null },
      user: { id: "user-a" },
    } as unknown as AuthSession
    const { recorded, layer } = sessionAccessLayer(session)
    return Effect.gen(function* () {
      const result = yield* resolveSessionAccess()
      assert.deepStrictEqual(result.access, {
        status: "ready",
        userId: "user-a",
        organizationId: "organization-a",
        organizationSlug: "organizationa",
      })
      assert.strictEqual(result.session, session)
      assert.lengthOf(result.organizations, 1)
      assert.strictEqual(recorded.listed, 1)
    }).pipe(Effect.provide(layer))
  })
})
