import { afterEach, expect, test, vi } from "vitest"
import { runMcpAuthorization } from "./mcp-authorization.ts"

afterEach(() => vi.unstubAllGlobals())

test("binds only the intended popup, origin and owner before completing with fresh authentication", async () => {
  const attempt = { organizationId: "organization", tenantId: "tenant", id: "attempt" }
  let receive!: (event: MessageEvent) => void
  const popup = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
  const bind = vi.fn().mockResolvedValue(undefined)
  const complete = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("window", {
    location: { origin: "https://customer.example" },
    open: () => popup,
    addEventListener: (_name: string, callback: typeof receive) => {
      receive = callback
    },
    removeEventListener: vi.fn(),
  })
  const pending = runMcpAuthorization({
    start: () =>
      Promise.resolve({ attempt, popupUrl: "https://platform.example/api/mcp/oauth/connect" }),
    bind,
    complete,
  })
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled())
  const send = (origin: string, source: unknown, data: unknown) =>
    receive({ origin, source, data } as MessageEvent)
  const challenge = { type: "mcp-browser-challenge", attempt, challenge: "nonce" }
  send("https://attacker.example", popup, challenge)
  send("https://platform.example", {}, challenge)
  send("https://platform.example", popup, {
    ...challenge,
    attempt: { ...attempt, tenantId: "foreign" },
  })
  send("https://platform.example", popup, {
    type: "mcp-authorization-result",
    attempt,
    status: "awaiting_completion",
  })
  expect(bind).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
  send("https://platform.example", popup, challenge)
  await vi.waitFor(() => expect(bind).toHaveBeenCalledExactlyOnceWith(attempt, "nonce"))
  send("https://platform.example", popup, {
    type: "mcp-authorization-result",
    attempt,
    status: "awaiting_completion",
  })
  await pending
  expect(complete).toHaveBeenCalledExactlyOnceWith(attempt)
  expect(popup.close).toHaveBeenCalledOnce()
  expect(popup.location.replace.mock.calls[0]![0]).toContain(
    "origin=https%3A%2F%2Fcustomer.example",
  )
})

test("closes the popup and reports trusted authorization failures without waiting for expiry", async () => {
  const attempt = { organizationId: "organization", tenantId: null, id: "attempt" }
  let receive!: (event: MessageEvent) => void
  const popup = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
  vi.stubGlobal("window", {
    location: { origin: "https://customer.example" },
    open: () => popup,
    addEventListener: (_name: string, callback: typeof receive) => {
      receive = callback
    },
    removeEventListener: vi.fn(),
  })
  const pending = runMcpAuthorization({
    start: () => Promise.resolve({ attempt, popupUrl: "https://platform.example/connect" }),
    bind: vi.fn(),
    complete: vi.fn(),
  })
  const rejected = pending.catch((error: unknown) => error)
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled())
  receive({
    origin: "https://platform.example",
    source: popup,
    data: { type: "mcp-authorization-result", attempt, status: "failed" },
  } as unknown as MessageEvent)
  expect(await rejected).toMatchObject({ message: "Authorization failed. Try connecting again." })
  expect(popup.close).toHaveBeenCalledOnce()
})
