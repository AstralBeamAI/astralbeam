import * as Effect from "effect/Effect"
import { beforeEach, expect, test, vi } from "vitest"

import { getGlobalConfig } from "@/lib/config"
import { isSetupComplete } from "@/lib/config/state.server"
import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import { Route } from "../token"

vi.mock("@/db", () => ({ runDatabaseEffect: Effect.runPromise }))
vi.mock("@/lib/config", () => ({ getGlobalConfig: vi.fn() }))
vi.mock("@/lib/config/state.server", () => ({ isSetupComplete: vi.fn() }))
vi.mock("@/lib/auth/dashboard-token.server", () => ({ issueDashboardToken: vi.fn() }))

const dashboardTokenHandler = (
  Route.options.server!.handlers as {
    POST: (context: { request: Request }) => Promise<Response>
  }
).POST

beforeEach(() => {
  vi.mocked(getGlobalConfig).mockReset().mockResolvedValue("https://app.example")
  vi.mocked(isSetupComplete).mockReset().mockResolvedValue(true)
  vi.mocked(issueDashboardToken)
    .mockReset()
    .mockReturnValue(Effect.succeed({ token: "signed" }))
})

test.each([
  ["https://other.example", "application/json", '{"organizationSlug":"dogfood"}', 403],
  ["", "application/json", '{"organizationSlug":"dogfood"}', 403],
  ["https://app.example", "text/plain", '{"organizationSlug":"dogfood"}', 403],
  ["https://app.example", "application/json", "{", 400],
  ["https://app.example", "application/json", '{"organizationSlug":"../other"}', 400],
  ["https://app.example", "application/json", '{"organizationSlug":"private-test-secret/"}', 400],
  ["https://app.example", "application/json", "x".repeat(1025), 413],
])("rejects invalid token requests (%s, %s, %s)", async (origin, contentType, body, status) => {
  const response = await dashboardTokenHandler({
    request: new Request("https://app.example/api/astralbeam/token", {
      method: "POST",
      headers: { origin, "content-type": contentType },
      body,
    }),
  })
  expect(response.status).toBe(status)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(await response.text()).not.toContain("private-test-secret")
  expect(issueDashboardToken).not.toHaveBeenCalled()
})

test("forwards the tab selector and never caches tokens or authentication failures", async () => {
  const request = new Request("https://app.example/api/astralbeam/token", {
    method: "POST",
    headers: { origin: "https://app.example", "content-type": "application/json" },
    body: JSON.stringify({ organizationSlug: "second", scope: "organization", extra: "ignored" }),
  })
  const response = await dashboardTokenHandler({ request: request.clone() })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ token: "signed" })
  expect(issueDashboardToken).toHaveBeenCalledWith({
    organizationSlug: "second",
    scope: "organization",
    headers: request.headers,
  })
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  vi.mocked(issueDashboardToken).mockReturnValue(
    Effect.fail({
      _tag: "DashboardTokenError",
      status: 401,
      message: "Authentication required",
      code: undefined,
    }),
  )
  const denied = await dashboardTokenHandler({ request })
  expect(denied.status).toBe(401)
  expect(denied.headers.get("cache-control")).toBe("private, no-store")
})
