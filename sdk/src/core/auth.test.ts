import { expect, test } from "vitest"

import {
  type ChatAuthenticationOptions,
  type ChatAuthenticationState,
  fetchAuthenticatedChat,
  getValidChatToken,
  initializeChatAuthentication,
} from "./auth.ts"

function jwt(expiresAt: number, marker: string) {
  const payload = btoa(JSON.stringify({ exp: Math.floor(expiresAt / 1_000), marker }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
  return `header.${payload}.signature`
}

test("chat authentication loads once and caches a token away from expiry", async () => {
  const token = jwt(Date.now() + 300_000, "cached")
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const states: ChatAuthenticationState[] = []
  const fetchClient = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input, ...(init ? { init } : {}) })
    return Promise.resolve(Response.json({ token }))
  }) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: (state: ChatAuthenticationState) => states.push(state),
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions

  await initializeChatAuthentication(authentication)
  expect(await getValidChatToken(authentication)).toBe(token)
  expect(requests).toHaveLength(1)
  expect(requests[0]?.input).toBe("/auth")
  expect(requests[0]?.init?.method).toBe("POST")
  expect(requests[0]?.init?.credentials).toBe("include")
  expect(states.map(({ status }) => status)).toEqual(["loading", "ready"])
})

test("chat authentication deduplicates concurrent refreshes", async () => {
  const token = jwt(Date.now() + 300_000, "deduplicated")
  let finish: ((response: Response) => void) | undefined
  let requestCount = 0
  const fetchClient = (async () => {
    requestCount += 1
    return await new Promise<Response>((resolve) => finish = resolve)
  }) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: () => undefined,
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions

  const first = getValidChatToken(authentication)
  const second = getValidChatToken(authentication)
  finish?.(Response.json({ token }))
  expect(await Promise.all([first, second])).toEqual([token, token])
  expect(requestCount).toBe(1)
})

test("chat authentication refreshes tokens near expiry", async () => {
  const tokens = [jwt(Date.now() + 30_000, "short"), jwt(Date.now() + 300_000, "fresh")]
  let requestCount = 0
  const fetchClient =
    (() => Promise.resolve(Response.json({ token: tokens[requestCount++] }))) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: () => undefined,
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions

  await initializeChatAuthentication(authentication)
  expect(await getValidChatToken(authentication)).toBe(tokens[1])
  expect(requestCount).toBe(2)
})

test("chat authentication refreshes and retries a rejected chat request once", async () => {
  const firstToken = jwt(Date.now() + 300_000, "first")
  const secondToken = jwt(Date.now() + 300_000, "second")
  let authRequests = 0
  let chatRequests = 0
  const fetchClient = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/auth") {
      return Promise.resolve(
        Response.json({ token: authRequests++ === 0 ? firstToken : secondToken }),
      )
    }
    chatRequests += 1
    const authorization = new Headers(init?.headers).get("authorization")
    if (chatRequests === 1) {
      expect(authorization).toBe(`Bearer ${firstToken}`)
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    expect(authorization).toBe(`Bearer ${secondToken}`)
    return Promise.resolve(new Response("ok"))
  }) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: () => undefined,
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions
  await initializeChatAuthentication(authentication)

  const response = await fetchAuthenticatedChat({
    ...authentication,
    input: "/chat",
    init: { headers: { authorization: `Bearer ${firstToken}` } },
  })
  expect(await response.text()).toBe("ok")
  expect(authRequests).toBe(2)
  expect(chatRequests).toBe(2)
})

test("a stale rejected request reuses a token another request already refreshed", async () => {
  const firstToken = jwt(Date.now() + 300_000, "first")
  const secondToken = jwt(Date.now() + 300_000, "second")
  let authRequests = 0
  let chatRequests = 0
  const fetchClient = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/auth") {
      return Promise.resolve(
        Response.json({ token: authRequests++ === 0 ? firstToken : secondToken }),
      )
    }
    chatRequests += 1
    if (chatRequests === 1) return Promise.resolve(new Response(null, { status: 401 }))
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${secondToken}`)
    return Promise.resolve(new Response("ok"))
  }) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: () => undefined,
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions
  await initializeChatAuthentication(authentication)
  await getValidChatToken({ ...authentication, force: true })

  const response = await fetchAuthenticatedChat({
    ...authentication,
    input: "/chat",
    init: { headers: { authorization: `Bearer ${firstToken}` } },
  })
  expect(await response.text()).toBe("ok")
  expect(authRequests).toBe(2)
})

test("chat authentication fails closed for malformed endpoint responses", async () => {
  let lastState: ChatAuthenticationState | undefined
  const fetchClient = (() => Promise.resolve(Response.json({ token: "not-a-jwt" }))) as typeof fetch
  const authentication = {
    authTokenUrl: "/auth",
    session: {
      cached: undefined,
      refreshPromise: undefined,
      abortController: new AbortController(),
    },
    onStateChange: (state: ChatAuthenticationState) => lastState = state,
    fetchClient,
    debug: undefined,
  } satisfies ChatAuthenticationOptions

  await expect(initializeChatAuthentication(authentication)).rejects.toThrow(/not a JWT/)
  expect(lastState?.status).toBe("error")
})
