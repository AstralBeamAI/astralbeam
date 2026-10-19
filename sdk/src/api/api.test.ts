import { assert, expect, test, vi } from "vitest"
import { getChatConfig, listTenants } from "./index.ts"
import { astralBeamApiFetch, isAstralBeamApiError } from "./api.ts"

test("typed credentials own authentication, preserving custom bases and queries", async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json({})))
  const signal = new AbortController().signal
  const options = {
    apiKey: "organization-key",
    apiUrl: "https://example.test/prefix/api/",
    signal,
    fetchClient,
    headers: { authorization: "Bearer ignored", "x-api-key": "ignored" },
  }
  await listTenants(
    { "filter[external_id]": "東京 / +", page_before: "cursor", page_size: 2 },
    options,
  )
  const [input, init] = fetchClient.mock.calls[0]!
  const request = new Request(input, init)
  const url = new URL(request.url)
  expect(url.pathname).toBe("/prefix/api/v1/tenants")
  expect(url.searchParams.get("filter[external_id]")).toBe("東京 / +")
  expect(url.searchParams.get("page_before")).toBe("cursor")
  expect(init).toMatchObject({ signal })
  // A redirect would forward the key header to whatever origin it names.
  expect(request.redirect).toBe("error")
  expect(new Headers(init?.headers).get("x-api-key")).toBe("organization-key")
  expect(new Headers(init?.headers).has("authorization")).toBe(false)

  await getChatConfig({}, { astralBeamToken: "jwt", fetchClient, apiUrl: "/api" })
  const [chatUrl, chatInit] = fetchClient.mock.calls[1]!
  expect(chatUrl).toBe("/api/v1/chat/config")
  expect(new Headers(chatInit?.headers).get("authorization")).toBe("Bearer jwt")
  expect(new Headers(chatInit?.headers).has("x-api-key")).toBe(false)
})

test("non-JSON HTTP errors preserve status and headers without retrying", async () => {
  const fetchClient = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response("<html>gateway</html>", { status: 429, headers: { "Retry-After": "2" } }),
    )
  const error = await listTenants({}, { apiKey: "key", fetchClient }).catch(
    (error: unknown) => error,
  )
  assert(isAstralBeamApiError(error))
  expect(error.status).toBe(429)
  expect(error.headers.get("Retry-After")).toBe("2")
  expect(error.body).toBeUndefined()
  expect(fetchClient).toHaveBeenCalledTimes(1)
})

test("204 successes do not attempt to decode an absent response body", async () => {
  const fetchClient = () => Promise.resolve(new Response(null, { status: 204 }))
  await expect(
    astralBeamApiFetch<void>("/resource", { method: "DELETE", apiKey: "key", fetchClient }),
  ).resolves.toBeUndefined()
})
