import { afterEach, expect, test, vi } from "vitest"
import { runMcpAuthorization } from "./mcp-authorization.ts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("binds only the intended popup, origin and owner before polling with fresh authentication", async () => {
  vi.useFakeTimers()
  const attempt = {
    organizationId: "organization",
    tenantId: "tenant",
    connectionId: "connection",
    id: "attempt",
  }
  let receive!: (event: MessageEvent) => void
  const popup = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
  let finishBinding!: () => void
  const bind = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishBinding = resolve
      }),
  )
  const complete = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true)
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
  expect(bind).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
  send("https://platform.example", popup, challenge)
  await vi.waitFor(() => expect(bind).toHaveBeenCalledExactlyOnceWith(attempt, "nonce"))
  expect(complete).not.toHaveBeenCalled()
  finishBinding()
  await vi.advanceTimersByTimeAsync(15_000)
  await pending
  expect(complete).toHaveBeenCalledTimes(3)
  expect(complete).toHaveBeenLastCalledWith(attempt)
  expect(popup.close).toHaveBeenCalledOnce()
  expect(popup.location.replace.mock.calls[0]![0]).toContain(
    "origin=https%3A%2F%2Fcustomer.example",
  )
})
