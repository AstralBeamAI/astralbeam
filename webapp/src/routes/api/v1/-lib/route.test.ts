import { beforeEach, describe, expect, test, vi } from "vitest"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { setupGateResponse } from "@/lib/config/state.server"
import { Route } from "../$"

vi.mock("@/db/lib/database-credentials.server", () => ({ getDatabaseBootstrapIssues: vi.fn() }))
vi.mock("@/lib/config/state.server", () => ({ setupGateResponse: vi.fn() }))

const routeHandler = (Route.options.server!.handlers as {
  ANY: (context: { request: Request }) => Promise<Response>
}).ANY

describe("REST route setup boundary", () => {
  beforeEach(() => {
    vi.mocked(getDatabaseBootstrapIssues).mockReset().mockReturnValue([])
    vi.mocked(setupGateResponse).mockReset().mockResolvedValue(null)
  })
  test.each(["bootstrap", "setup"])(
    "preserves safe 503 with CORS/no-store for %s",
    async (kind) => {
      if (kind === "bootstrap") {
        vi.mocked(getDatabaseBootstrapIssues).mockReturnValue(["DATABASE_URL"])
      } else {
        vi.mocked(setupGateResponse).mockResolvedValue(
          new Response("private setup details", { status: 503 }),
        )
      }
      const response = await routeHandler({
        request: new Request("http://localhost/api/v1/tenants"),
      })
      expect(response.status).toBe(503)
      expect(response.headers.get("retry-after")).toBe("10")
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.json()).toMatchObject({
        status: 503,
        detail: "Server configuration required.",
      })
    },
  )
  test("preflight does not consult setup or authentication", async () => {
    const response = await routeHandler({
      request: new Request("http://localhost/api/v1/tenants", { method: "OPTIONS" }),
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-credentials")).toBeNull()
    expect(getDatabaseBootstrapIssues).not.toHaveBeenCalled()
    expect(setupGateResponse).not.toHaveBeenCalled()
  })
})
