import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Logger } from "effect"
import { beforeEach, vi } from "vitest"

import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import { EmbeddedAssistantUnavailable } from "@/lib/auth/errors"
import { Config, type SetupState } from "@/lib/config/config.server"
import { handleDashboardTokenRequest } from "./token.server.ts"

// Issuance has its own services; this boundary only decides what reaches it.
vi.mock("@/lib/auth/dashboard-token.server", () => ({ issueDashboardToken: vi.fn() }))

const config = Layer.succeed(Config, {
  get: () => Effect.succeed("https://app.example"),
  setupState: Effect.succeed({ setupComplete: true } as SetupState),
} as unknown as Config["Service"])

function tokenRequest(origin: string, contentType: string, body: string) {
  return new Request("https://app.example/api/astralbeam/token", {
    method: "POST",
    headers: { origin, "content-type": contentType },
    body,
  })
}

// The mocked issuer needs none of the services its real type still names.
const respond = (request: Request) =>
  (handleDashboardTokenRequest(request) as Effect.Effect<Response, never, Config>).pipe(
    Effect.provide(config),
  )

beforeEach(() => {
  vi.mocked(issueDashboardToken)
    .mockReset()
    .mockReturnValue(Effect.succeed({ token: "signed" }))
})

describe("dashboard token boundary", () => {
  it.effect("rejects invalid token requests before issuing anything", () =>
    Effect.gen(function* () {
      for (const [origin, contentType, body, status] of [
        ["https://other.example", "application/json", '{"organizationSlug":"dogfood"}', 403],
        ["", "application/json", '{"organizationSlug":"dogfood"}', 403],
        ["https://app.example", "text/plain", '{"organizationSlug":"dogfood"}', 403],
        ["https://app.example", "application/json", "{", 400],
        ["https://app.example", "application/json", '{"organizationSlug":"../other"}', 400],
        [
          "https://app.example",
          "application/json",
          '{"organizationSlug":"private-test-secret/"}',
          400,
        ],
        ["https://app.example", "application/json", "x".repeat(1025), 413],
      ] as const) {
        const response = yield* respond(tokenRequest(origin, contentType, body))
        assert.strictEqual(response.status, status)
        assert.strictEqual(response.headers.get("cache-control"), "private, no-store")
        assert.notInclude(yield* Effect.promise(() => response.text()), "private-test-secret")
      }
      assert.strictEqual(vi.mocked(issueDashboardToken).mock.calls.length, 0)
    }),
  )

  it.effect("forwards the tab selector and never caches tokens or failures", () =>
    Effect.gen(function* () {
      const request = tokenRequest(
        "https://app.example",
        "application/json",
        JSON.stringify({ organizationSlug: "second", scope: "organization", extra: "ignored" }),
      )
      const response = yield* respond(request.clone())
      assert.strictEqual(response.status, 200)
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), { token: "signed" })
      assert.deepStrictEqual(vi.mocked(issueDashboardToken).mock.calls[0]?.[0], {
        organizationSlug: "second",
        scope: "organization",
        headers: request.headers,
      })
      assert.strictEqual(response.headers.get("cache-control"), "private, no-store")

      vi.mocked(issueDashboardToken).mockReturnValue(
        Effect.fail(new EmbeddedAssistantUnavailable()),
      )
      const unavailable = yield* respond(request.clone())
      assert.strictEqual(unavailable.status, 503)
      assert.strictEqual(unavailable.headers.get("cache-control"), "private, no-store")
    }),
  )

  it.effect("reports an unexpected failure once and answers without its details", () =>
    Effect.gen(function* () {
      const lines: string[] = []
      vi.mocked(issueDashboardToken).mockReturnValue(
        Effect.die(new Error("postgres://user:secret@db/app")),
      )
      const response = yield* respond(
        tokenRequest("https://app.example", "application/json", '{"organizationSlug":"acme"}'),
      ).pipe(
        Effect.provide(Logger.layer([Logger.map(Logger.formatJson, (line) => lines.push(line))])),
      )
      assert.strictEqual(response.status, 500)
      assert.notInclude(yield* Effect.promise(() => response.text()), "secret")
      assert.strictEqual(lines.length, 1)
      assert.notInclude(lines[0], "secret")
    }),
  )
})
