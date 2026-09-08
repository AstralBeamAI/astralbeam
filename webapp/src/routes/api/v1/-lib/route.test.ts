import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { setupGateResponse } from "@/lib/config/state.server"
import { Route } from "../$"
import { Route as LegacyChatRoute } from "../../chat/$"
import { dispatchRestRequest } from "./transport.server"

vi.mock("@/db/lib/database-credentials.server", () => ({ getDatabaseBootstrapIssues: vi.fn() }))
vi.mock("@/lib/config/state.server", () => ({ setupGateResponse: vi.fn() }))
vi.mock("./transport.server", () => ({ dispatchRestRequest: vi.fn() }))

const routeHandler = (Route.options.server!.handlers as {
  ANY: (context: { request: Request }) => Promise<Response>
}).ANY

describe("v1 setup boundary", () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    vi.mocked(dispatchRestRequest).mockReset()
    vi.mocked(getDatabaseBootstrapIssues).mockReset().mockReturnValue([])
    vi.mocked(setupGateResponse).mockReset().mockResolvedValue(null)
  })
  test("legacy chat forwards the request and response without buffering or redirecting", async () => {
    const legacy = (LegacyChatRoute.options.server!.handlers as { ANY: typeof routeHandler }).ANY
    const abort = new AbortController()
    const request = new Request("http://localhost/api/chat/?trace=example", {
      method: "POST",
      headers: { authorization: "Bearer example", "content-type": "application/json" },
      body: "{}",
      signal: abort.signal,
    })
    const response = new Response(new ReadableStream(), {
      headers: { "content-type": "text/event-stream" },
    })
    vi.mocked(dispatchRestRequest).mockResolvedValue(response)
    expect(await legacy({ request })).toBe(response)
    const forwarded = vi.mocked(dispatchRestRequest).mock.calls[0]![0]
    expect(forwarded.url).toBe("http://localhost/api/v1/chat?trace=example")
    expect(forwarded.method).toBe("POST")
    expect([...forwarded.headers]).toEqual([...request.headers])
    expect(await forwarded.text()).toBe("{}")
    abort.abort()
    expect(forwarded.signal.aborted).toBe(true)
    await response.body!.cancel()
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
        request: new Request("http://localhost/api/v1/chat"),
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
  test.each(["tenants", "chat", "chat/config", "chat/files"])(
    "%s preflight bypasses setup and authentication",
    async (path) => {
      const response = await routeHandler({
        request: new Request(`http://localhost/api/v1/${path}`, { method: "OPTIONS" }),
      })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-max-age")).toBe("86400")
      expect(response.headers.get("access-control-allow-credentials")).toBeNull()
      expect(getDatabaseBootstrapIssues).not.toHaveBeenCalled()
      expect(setupGateResponse).not.toHaveBeenCalled()
    },
  )
  test("unexpected setup failures log safe diagnostics once", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(setupGateResponse).mockRejectedValue(
      Object.assign(new Error("private connection details"), { code: "08006" }),
    )
    const response = await routeHandler({ request: new Request("http://localhost/api/v1/tenants") })
    expect(response.status).toBe(500)
    expect(logged).toHaveBeenCalledExactlyOnceWith("API request failed", {
      stage: "setup",
      status: 500,
      errorType: "Error",
      code: "08006",
    })
    expect(await response.text()).not.toContain("private connection details")
  })
})
