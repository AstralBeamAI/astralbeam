import { expect, expectTypeOf, test, vi } from "vitest"
import { getChatConfig, getChatFile, listTenants, updateTenant } from "./index.ts"
import { isAstralBeamApiError } from "./api.ts"

test("typed credentials own authentication, preserving custom bases and queries", async () => {
  const fetchClient = vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(Response.json({}))
  )
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
  const [url, init] = fetchClient.mock.calls[0]!
  expect(new URL(String(url)).pathname).toBe("/prefix/api/v1/tenants")
  expect(new URL(String(url)).searchParams.get("filter[external_id]")).toBe("東京 / +")
  expect(new URL(String(url)).searchParams.get("page_before")).toBe("cursor")
  expect(init).toMatchObject({ signal })
  expect(new Request(String(url), init).redirect).toBe("follow")
  expect(new Headers(init?.headers).get("x-api-key")).toBe("organization-key")
  expect(new Headers(init?.headers).has("authorization")).toBe(false)

  await getChatConfig({}, { astralBeamToken: "jwt", fetchClient, apiUrl: "/api" })
  const [chatUrl, chatInit] = fetchClient.mock.calls[1]!
  expect(chatUrl).toBe("/api/v1/chat/config")
  expect(new Headers(chatInit?.headers).get("authorization")).toBe("Bearer jwt")
  expect(new Headers(chatInit?.headers).has("x-api-key")).toBe(false)
})

test("non-JSON HTTP errors preserve status and headers without retrying", async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("<html>gateway</html>", { status: 429, headers: { "Retry-After": "2" } }),
  )
  const error = await listTenants({}, { apiKey: "key", fetchClient }).catch((error) => error)
  expect(isAstralBeamApiError(error)).toBe(true)
  expect(error.status).toBe(429)
  expect(error.headers.get("Retry-After")).toBe("2")
  expect(error.body).toBeUndefined()
  expect(fetchClient).toHaveBeenCalledTimes(1)
})

test("invalid JSON successes and native abort errors propagate", async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid json"))
  await expect(listTenants({}, { apiKey: "key", fetchClient })).rejects.toBeInstanceOf(SyntaxError)
  const error = new DOMException("aborted", "AbortError")
  fetchClient.mockReset().mockRejectedValue(error)
  await expect(updateTenant("id", { name: null }, { apiKey: "key", fetchClient })).rejects.toBe(
    error,
  )
  expect(fetchClient).toHaveBeenCalledTimes(1)
})

test("generated authentication types distinguish resources, chat and tickets", () => {
  type ResourceOptions = NonNullable<Parameters<typeof listTenants>[1]>
  type ChatOptions = NonNullable<Parameters<typeof getChatConfig>[1]>
  type DownloadOptions = NonNullable<Parameters<typeof getChatFile>[1]>
  expectTypeOf<{ apiKey: string }>().toExtend<ResourceOptions>()
  expectTypeOf<{ astralBeamToken: string }>().toExtend<ResourceOptions>()
  expectTypeOf<{ apiKey: string; astralBeamToken: string }>().not.toExtend<ResourceOptions>()
  expectTypeOf<{ apiKey: string }>().not.toExtend<ChatOptions>()
  expectTypeOf<{ astralBeamToken: string }>().not.toExtend<DownloadOptions>()
  expectTypeOf<[Record<string, never>]>().not.toExtend<Parameters<typeof listTenants>>()
  expectTypeOf<[Record<string, never>]>().not.toExtend<Parameters<typeof getChatConfig>>()
})
