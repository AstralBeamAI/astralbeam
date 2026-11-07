import { afterEach, expect, test, vi } from "vitest"
import { authorizeMcpConnection } from "./mcp.ts"

const attempt = {
  organizationId: "organization",
  tenantId: "tenant",
  connectionId: "connection",
  id: "attempt",
}
const authorizationResponse = () =>
  Response.json({
    popup_url: "https://platform.example/api/mcp/oauth/connect",
    attempt: {
      organization_id: attempt.organizationId,
      tenant_id: attempt.tenantId,
      connection_id: attempt.connectionId,
      id: attempt.id,
    },
  })

function mockPopup() {
  let receive!: (event: MessageEvent) => void
  const popup = { closed: false, close: vi.fn(), location: { replace: vi.fn() } }
  const removeEventListener = vi.fn()
  vi.stubGlobal("window", {
    location: { origin: "https://customer.example" },
    open: () => popup,
    addEventListener: (_name: string, callback: typeof receive) => (receive = callback),
    removeEventListener,
  })
  return {
    popup,
    removeEventListener,
    send: (origin: string, source: unknown, data: unknown) =>
      receive({ origin, source, data } as MessageEvent),
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test.each([true, false])("retries OAuth before popup completion (%s)", async (authorized) => {
  vi.useFakeTimers()
  const { popup, send } = mockPopup()
  let finishBinding!: () => void
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: "connection" }))
    .mockResolvedValueOnce(authorizationResponse())
    .mockRejectedValueOnce(new TypeError("Binding response lost"))
    .mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishBinding = () => resolve(new Response(null, { status: 204 }))
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(false))
    .mockResolvedValueOnce(Response.json(authorized))
  let authCalls = 0
  const requestOptions = () => {
    if (++authCalls === 4)
      return Promise.reject(Object.assign(new Error("Host JWT endpoint busy"), { status: 429 }))
    return Promise.resolve({ astralBeamToken: `token-${authCalls}`, fetchClient })
  }
  const pending = authorizeMcpConnection({ mcpServerId: "server" }, requestOptions).then(
    (id) => id,
    (error: Error) => error.message,
  )
  await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled())
  const challenge = { type: "mcp-browser-challenge", attempt, challenge: "nonce" }
  send("https://attacker.example", popup, challenge)
  send("https://platform.example", {}, challenge)
  send("https://platform.example", popup, {
    ...challenge,
    attempt: { ...attempt, tenantId: "foreign" },
  })
  expect(fetchClient).toHaveBeenCalledTimes(2)
  send("https://platform.example", popup, challenge)
  await vi.waitFor(() => expect(fetchClient).toHaveBeenCalledTimes(3))
  expect(fetchClient.mock.lastCall![1]!.body).toBe(
    JSON.stringify({ attempt_id: "attempt", challenge: "nonce" }),
  )
  await vi.advanceTimersByTimeAsync(5_000)
  expect(fetchClient).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchClient).toHaveBeenCalledTimes(4)
  finishBinding()
  await vi.waitFor(() => expect(fetchClient).toHaveBeenCalledTimes(5))
  await vi.advanceTimersByTimeAsync(5_000)
  popup.closed = true
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await pending).toBe(authorized ? "connection" : "Authorization window closed.")
  expect(fetchClient).toHaveBeenCalledTimes(7)
  expect(new Headers(fetchClient.mock.lastCall![1]!.headers).get("authorization")).toBe(
    "Bearer token-8",
  )
  expect(popup.close).toHaveBeenCalledOnce()
  expect(popup.location.replace.mock.calls[0]![0]).toContain(
    "origin=https%3A%2F%2Fcustomer.example",
  )
})

test.each(
  ["binding", "completion"].flatMap((phase) =>
    ["authentication", "request"].map((waiting) => ({ phase, waiting })),
  ),
)(
  "expiry during $phase $waiting prevents further authorization work",
  async ({ phase, waiting }) => {
    vi.useFakeTimers()
    const { popup, send, removeEventListener } = mockPopup()
    const fetchClient = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authorizationResponse())
      .mockResolvedValue(new Response(null, { status: 204 }))
    const held = Promise.withResolvers<void>()
    let requestSignal: AbortSignal | null | undefined
    if (waiting === "request")
      fetchClient.mockImplementation(async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : input.toString()).pathname
        if (path.endsWith(phase === "binding" ? "/bind" : "/complete")) {
          requestSignal = init?.signal
          await held.promise
        }
        return new Response(null, { status: 204 })
      })
    let authCalls = 0
    const requestOptions = async () => {
      authCalls++
      if (waiting === "authentication" && authCalls === (phase === "binding" ? 2 : 3))
        await held.promise
      return { astralBeamToken: "token", fetchClient }
    }
    const pending = authorizeMcpConnection(
      { mcpServerId: "server", id: "connection" },
      requestOptions,
    ).catch((error: Error) => error.message)
    await vi.waitFor(() => expect(popup.location.replace).toHaveBeenCalled())
    send("https://platform.example", popup, {
      type: "mcp-browser-challenge",
      attempt,
      challenge: "nonce",
    })
    await vi.waitFor(() => expect(authCalls).toBe(phase === "binding" ? 2 : 3))
    await vi.waitUntil(() => waiting !== "request" || requestSignal !== undefined)
    const dispatched = fetchClient.mock.calls.length
    await vi.advanceTimersByTimeAsync(600_000)
    expect(await pending).toBe("Authorization expired. Try connecting again.")
    held.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchClient).toHaveBeenCalledTimes(dispatched)
    expect(requestSignal?.aborted).toBe(waiting === "request" ? true : undefined)
    expect(popup.close).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  },
)
