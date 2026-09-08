import { expect, expectTypeOf, test, vi } from "vitest"
import { getChatConfig, getChatFile, listTenants, runChat, updateTenant } from "./index.ts"
import { isAstralBeamApiError } from "./api.ts"

test("typed credentials own authentication, preserving custom bases, queries and payloads", async () => {
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
  expect(init).toMatchObject({ signal, redirect: "error" })
  expect(new Headers(init?.headers).get("x-api-key")).toBe("organization-key")
  expect(new Headers(init?.headers).has("authorization")).toBe(false)

  await updateTenant("id/encoded", { metadata: { camelKey: 1, external_id: "unchanged" } }, options)
  expect(fetchClient.mock.calls[1]![0]).toContain("/id%2Fencoded")
  expect(JSON.parse(String(fetchClient.mock.calls[1]![1]?.body))).toEqual({
    metadata: { camelKey: 1, external_id: "unchanged" },
  })
  await getChatConfig({}, { astralBeamToken: "jwt", fetchClient, apiUrl: "/api" })
  const [chatUrl, chatInit] = fetchClient.mock.calls[2]!
  expect(chatUrl).toBe("/api/v1/chat/config")
  expect(new Headers(chatInit?.headers).get("authorization")).toBe("Bearer jwt")
  expect(new Headers(chatInit?.headers).has("x-api-key")).toBe(false)
})

test("raw chat and file responses remain unread", async () => {
  const response = new Response("first chunk", { headers: { "Content-Disposition": "attachment" } })
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(response)
  expect(
    await runChat({ threadId: "t", runId: "r", messages: [], tools: [], context: [] }, {
      astralBeamToken: "jwt",
      fetchClient,
    }),
  ).toBe(response)
  expect(response.bodyUsed).toBe(false)
  expect(await getChatFile({ ticket: "signed/ticket" }, { fetchClient })).toBe(response)
  expect(new Headers(fetchClient.mock.calls[1]![1]?.headers).has("authorization")).toBe(false)
  expect(await response.text()).toBe("first chunk")
})

test("HTTP errors preserve status and headers, including non-JSON gateways", async () => {
  for (
    const body of [
      "<html>gateway</html>",
      JSON.stringify({
        type: "about:blank",
        title: "Too Many Requests",
        status: 429,
        detail: "Try later",
      }),
    ]
  ) {
    const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 429,
        headers: { "Retry-After": "2" },
      }),
    )
    const error = await listTenants({}, { apiKey: "key", fetchClient }).catch((error) => error)
    expect(isAstralBeamApiError(error)).toBe(true)
    expect(error.status).toBe(429)
    expect(error.headers.get("Retry-After")).toBe("2")
    expect(error.body?.detail).toBe(body.includes("Try later") ? "Try later" : undefined)
    expect(fetchClient).toHaveBeenCalledTimes(1)
  }
})

test("JSON parse, network and abort errors propagate without retries", async () => {
  const fetchClient = vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid json"))
  await expect(listTenants({}, { apiKey: "key", fetchClient })).rejects.toBeInstanceOf(SyntaxError)
  for (
    const error of [new TypeError("network failed"), new DOMException("aborted", "AbortError")]
  ) {
    fetchClient.mockReset().mockRejectedValue(error)
    await expect(updateTenant("id", { name: null }, { apiKey: "key", fetchClient })).rejects.toBe(
      error,
    )
    expect(fetchClient).toHaveBeenCalledTimes(1)
  }
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
