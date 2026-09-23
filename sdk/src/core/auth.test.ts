import { afterEach, expect, test, vi } from "vitest"
import {
  authenticationState,
  createChatAuthentication,
  disposeChatAuthentication,
  fetchAuthenticatedChat,
  getValidChatAuthToken,
  initializeChatAuthentication,
  updateAuthentication,
} from "./auth.ts"
import { startAuthentication } from "./auth-lifecycle.ts"

function jwt(marker = "user", lifetime = 300) {
  const iat = Math.floor(Date.now() / 1_000)
  return `header.${btoa(JSON.stringify({ iat, exp: iat + lifetime, marker }))}.signature`
}
const currentUser = {
  scope: "tenant",
  organization: { id: "org" },
  tenant: { id: "tenant" },
  user: { id: "user", name: "First", admin: false },
}
function authentication() {
  const auth = createChatAuthentication({
    apiUrl: "https://api.example/api",
    fetchAstralBeamToken: { url: "/auth" },
  })
  const fetch = vi.fn<typeof globalThis.fetch>((input) =>
    Promise.resolve(Response.json(input === "/auth" ? { token: jwt() } : currentUser)),
  )
  auth.fetchClient = fetch
  return { auth, fetch }
}
function browser() {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const window = new EventTarget()
  vi.stubGlobal("document", document)
  vi.stubGlobal("addEventListener", window.addEventListener.bind(window))
  vi.stubGlobal("navigator", { onLine: true })
  return document
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("coalesces token acquisition and /me, publishing only a synchronized identity", async () => {
  const { auth, fetch } = authentication()
  const response = Promise.withResolvers<Response>()
  fetch.mockImplementation((input) =>
    input === "/auth" ? Promise.resolve(Response.json({ token: jwt() })) : response.promise,
  )
  const first = getValidChatAuthToken(auth)
  const second = getValidChatAuthToken(auth)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(authenticationState(auth).status).toBe("loading")
  expect(auth.session.cached).toBeUndefined()
  response.resolve(Response.json(currentUser))
  expect(await first).toBe(await second)
  expect(await getValidChatAuthToken(auth)).toBe(await first)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(authenticationState(auth)).toEqual({ status: "ready", currentUser })
  expect(fetch.mock.calls[1]![1]).toMatchObject({ credentials: "omit", cache: "no-store" })
})

test("request init stays host-owned and both signals cancel token acquisition", async () => {
  const { auth, fetch } = authentication()
  const controller = new AbortController()
  auth.fetchAstralBeamToken = {
    url: "/auth",
    credentials: "omit",
    signal: controller.signal,
    headers: { authorization: "Bearer host" },
  }
  await initializeChatAuthentication(auth)
  const init = fetch.mock.calls[0]![1]!
  expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store" })
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer host")
  controller.abort()
  expect(init.signal?.aborted).toBe(true)
  expect(new Headers(fetch.mock.calls[1]![1]?.headers).get("authorization")).toBe(
    `Bearer ${auth.session.cached!.value}`,
  )
  disposeChatAuthentication(auth)
  expect(fetch.mock.calls[1]![1]?.signal?.aborted).toBe(true)
})

test("expired and near-expiry source tokens fail instead of starting a refresh loop", async () => {
  const { auth, fetch } = authentication()
  auth.fetchAstralBeamToken = () => ({ token: jwt("expired", -1) })
  await expect(getValidChatAuthToken(auth)).rejects.toThrow(/expired/)
  auth.fetchAstralBeamToken = () => ({ token: jwt("too-short", 1) })
  await expect(getValidChatAuthToken(auth)).rejects.toThrow(/expiry/)
  expect(fetch).not.toHaveBeenCalled()
})

test("failed /me clears the old credential and profile, and scope mismatches fail", async () => {
  const { auth, fetch } = authentication()
  await initializeChatAuthentication(auth)
  auth.fetchAstralBeamToken = () => ({ token: jwt() })
  fetch.mockResolvedValue(Response.json({ detail: "Unavailable" }, { status: 503 }))
  await expect(getValidChatAuthToken({ ...auth, force: true })).rejects.toMatchObject({
    status: 503,
  })
  expect(auth.session.cached).toBeUndefined()
  expect(authenticationState(auth)).not.toHaveProperty("currentUser")
  fetch.mockResolvedValue(Response.json(currentUser))
  auth.scope = "organization"
  await expect(getValidChatAuthToken(auth)).rejects.toThrow(/Expected organization/)
})

test("only a 401 retries initial /me, and a rejected resource has one renewal budget", async () => {
  const { auth, fetch } = authentication()
  let count = 0
  const source = vi.fn(() => ({ token: jwt(String(count++)) }))
  auth.fetchAstralBeamToken = source
  fetch
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValue(Response.json(currentUser))
  await getValidChatAuthToken(auth)
  expect(source).toHaveBeenCalledTimes(2)
  fetch
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json(currentUser))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  await expect(
    fetchAuthenticatedChat({
      ...auth,
      input: "/chat",
      init: { headers: { authorization: `Bearer ${auth.session.cached!.value}` } },
    }),
  ).resolves.toMatchObject({ status: 401 })
  expect(source).toHaveBeenCalledTimes(3)
  expect(new Headers(fetch.mock.calls.at(-1)![1]?.headers).get("authorization")).toBe(
    `Bearer ${auth.session.cached!.value}`,
  )
})

test.each([403, 404, 429])("/me HTTP %s is not retried as an expired token", async (status) => {
  const { auth, fetch } = authentication()
  const source = vi.fn(() => ({ token: jwt() }))
  auth.fetchAstralBeamToken = source
  fetch.mockResolvedValue(new Response(null, { status }))
  await expect(getValidChatAuthToken(auth)).rejects.toMatchObject({ status })
  expect(source).toHaveBeenCalledOnce()
})

test("disposal and API changes discard late host callbacks and current-user responses", async () => {
  const { auth, fetch } = authentication()
  const source = Promise.withResolvers<{ token: string }>()
  auth.fetchAstralBeamToken = () => source.promise
  const old = getValidChatAuthToken(auth)
  disposeChatAuthentication(auth)
  source.resolve({ token: jwt() })
  await expect(old).rejects.toMatchObject({ name: "AbortError" })
  expect(fetch).not.toHaveBeenCalled()
  const response = Promise.withResolvers<Response>()
  updateAuthentication(auth, {
    apiUrl: "https://new.example/api",
    fetchAstralBeamToken: () => ({ token: jwt() }),
  })
  fetch.mockReturnValue(response.promise)
  const pending = getValidChatAuthToken(auth)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  updateAuthentication(auth, {
    apiUrl: "https://other.example/api",
    fetchAstralBeamToken: auth.fetchAstralBeamToken,
  })
  response.resolve(Response.json(currentUser))
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  expect(authenticationState(auth).status).toBe("loading")
})

test("browser lifecycle refreshes with the latest source, pauses hidden, revalidates foreground, and cleans up", async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const document = browser()
  const { auth, fetch } = authentication()
  auth.fetchAstralBeamToken = () => ({ token: jwt("user", 60) })
  const stop = startAuthentication(auth)
  await vi.advanceTimersByTimeAsync(0)
  const next = vi.fn(() => ({ token: jwt("updated", 60) }))
  updateAuthentication(auth, { apiUrl: auth.apiUrl, fetchAstralBeamToken: next })
  fetch.mockResolvedValue(
    Response.json({ ...currentUser, user: { ...currentUser.user, name: "Updated" } }),
  )
  await vi.advanceTimersByTimeAsync(48_000)
  expect(next).toHaveBeenCalledOnce()
  expect(authenticationState(auth)).toMatchObject({ currentUser: { user: { name: "Updated" } } })
  expect(fetch).toHaveBeenCalledTimes(2)
  document.visibilityState = "hidden"
  document.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(100)
  document.visibilityState = "visible"
  document.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(48_000)
  expect(fetch).toHaveBeenCalledTimes(3)
  document.visibilityState = "hidden"
  document.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(fetch).toHaveBeenCalledTimes(3)
  document.visibilityState = "visible"
  document.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(4)
  stop()
  disposeChatAuthentication(auth)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(fetch).toHaveBeenCalledTimes(4)
})

test.each([false, true])(
  "a rejected chat never replays across an identity change (concurrent: %s)",
  async (concurrent) => {
    const { auth, fetch } = authentication()
    await initializeChatAuthentication(auth)
    const token = auth.session.cached!.value
    const response = Promise.withResolvers<Response>()
    fetch
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue(
        Response.json({ ...currentUser, user: { ...currentUser.user, id: "other" } }),
      )
    auth.fetchAstralBeamToken = () => ({ token: jwt("other") })
    const request = fetchAuthenticatedChat({
      ...auth,
      input: "/chat",
      init: { headers: { authorization: `Bearer ${token}` } },
    })
    if (concurrent) await getValidChatAuthToken({ ...auth, force: true })
    response.resolve(new Response(null, { status: 401 }))
    await expect(request).rejects.toMatchObject({ name: "AbortError" })
    expect(fetch).toHaveBeenCalledTimes(4)
  },
)

test("renewal preserves ready state until it succeeds or fails", async () => {
  const { auth, fetch } = authentication()
  await initializeChatAuthentication(auth)
  const response = Promise.withResolvers<Response>()
  auth.fetchAstralBeamToken = () => ({ token: jwt("new") })
  fetch.mockReturnValue(response.promise)
  const renewal = getValidChatAuthToken({ ...auth, force: true })
  expect(authenticationState(auth)).toEqual({ status: "ready", currentUser })
  response.resolve(new Response(null, { status: 403 }))
  await expect(renewal).rejects.toMatchObject({ status: 403 })
  expect(authenticationState(auth).status).toBe("error")
  expect(auth.session.cached).toBeUndefined()
})

test("transient synchronization retries honor Retry-After and stop after three attempts", async () => {
  vi.useFakeTimers()
  browser()
  const { auth, fetch } = authentication()
  auth.fetchAstralBeamToken = () => ({ token: jwt() })
  fetch.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 429, headers: { "Retry-After": "10" } })),
  )
  const stop = startAuthentication(auth)
  await vi.advanceTimersByTimeAsync(9_999)
  expect(fetch).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(20_001)
  expect(fetch).toHaveBeenCalledTimes(4)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(fetch).toHaveBeenCalledTimes(4)
  stop()
  disposeChatAuthentication(auth)
})
