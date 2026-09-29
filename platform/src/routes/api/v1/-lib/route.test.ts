import { describe, expect, test, vi } from "vitest"
import { Route as LegacyChatRoute } from "../../chat/$"
import { handleApiV1Request } from "./route.server"

vi.mock("./route.server", () => ({ handleApiV1Request: vi.fn() }))

describe("temporary /api/chat alias", () => {
  test("legacy chat forwards the request and response without buffering or redirecting", async () => {
    const legacy = (
      LegacyChatRoute.options.server!.handlers as {
        ANY: (context: { request: Request }) => Promise<Response>
      }
    ).ANY
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
    vi.mocked(handleApiV1Request).mockResolvedValue(response)
    expect(await legacy({ request })).toBe(response)
    const forwarded = vi.mocked(handleApiV1Request).mock.calls[0]![0]
    expect(forwarded.url).toBe("http://localhost/api/v1/chat?trace=example")
    expect(forwarded.method).toBe("POST")
    expect([...forwarded.headers]).toEqual([...request.headers])
    expect(await forwarded.text()).toBe("{}")
    abort.abort()
    expect(forwarded.signal.aborted).toBe(true)
    await response.body!.cancel()
  })
})

describe("v1 entrypoint", () => {
  test("answers preflight and missing database variables without building services", async () => {
    vi.stubEnv("DATABASE_URL", "")
    vi.stubEnv("DATABASE_ENCRYPTION_KEY", "")
    const { handleApiV1Request: handle } =
      await vi.importActual<typeof import("./route.server")>("./route.server")
    const url = "http://localhost/api/v1/tenants"
    const preflight = await handle(new Request(url, { method: "OPTIONS" }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-max-age")).toBe("86400")
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull()
    const response = await handle(new Request(url))
    expect(response.status).toBe(503)
    expect(response.headers.get("retry-after")).toBe("10")
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toMatchObject({ detail: "Server configuration required." })
    vi.unstubAllEnvs()
  })
})
