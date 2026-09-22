import { disposeChatAuthentication, getValidChatAuthToken } from "./auth.ts"
import { describe, expect, test, vi } from "vitest"
import {
  disposeListingSession,
  listingRequest,
  listingSession,
  loadListingPage,
  resolveListingTenant,
} from "./listings.ts"

vi.mock("../api/generated/api.ts", async (original) => ({
  ...await original<typeof import("../api/generated/api.ts")>(),
  getCurrentUser: (_body: unknown, { astralBeamToken }: { astralBeamToken: string }) => {
    const payload = JSON.parse(atob(astralBeamToken.split(".")[1]!))
    return Promise.resolve(
      payload.email
        ? {
          scope: "organization",
          organization: { id: payload.organization_id },
          user: { id: payload.email, email: payload.email, role: "owner" },
        }
        : {
          scope: "tenant",
          organization: { id: payload.iss },
          tenant: { id: payload.tenant.id },
          user: { id: payload.user.id, admin: payload.user.admin },
        },
    )
  },
}))

function token(
  email = "operator@example.com",
  organization = true,
  organizationId = "organization",
) {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
  return [
    encode({ typ: organization ? "astralbeam-organization+jwt" : "astralbeam+jwt" }),
    encode({
      iss: organizationId,
      ...(organization
        ? { organization_id: organizationId, email }
        : { tenant: { id: "tenant" }, user: { id: "user", admin: true } }),
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
    "signature",
  ].join(".")
}

function apiError(status: number) {
  return Object.assign(new Error("Denied"), {
    name: "AstralBeamApiError",
    status,
    headers: new Headers(),
  })
}

describe("listing authentication lifecycle", () => {
  test("updates token sources without clearing cached authentication and uses the latest error callback", async () => {
    const oldError = vi.fn()
    const onError = vi.fn()
    const source = vi.fn().mockResolvedValue({ token: token() })
    const nextSource = vi.fn().mockResolvedValue({ token: token() })
    const session = listingSession({
      scope: "organization",
      fetchAstralBeamToken: source,
      onError: oldError,
    }, vi.fn())
    const signal = new AbortController().signal
    await listingRequest(session, signal, () => Promise.resolve("rows"))
    session.options = { ...session.options, fetchAstralBeamToken: nextSource, onError }
    await listingRequest(session, signal, () => Promise.resolve("rows"))
    expect(nextSource).not.toHaveBeenCalled()
    const request = vi.fn().mockRejectedValueOnce(apiError(401)).mockResolvedValueOnce("refreshed")
    expect(await listingRequest(session, signal, request)).toBe("refreshed")
    expect(nextSource).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    const denied = apiError(401)
    const rejected = vi.fn().mockRejectedValue(denied)
    await expect(listingRequest(session, signal, rejected)).rejects.toBe(denied)
    expect(rejected).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledExactlyOnceWith(denied)
    expect(oldError).not.toHaveBeenCalled()
    disposeListingSession(session)
  })

  test("a late 401 reuses the token another request already refreshed", async () => {
    const original = token()
    const refreshed = `${original}-refreshed`
    const source = vi.fn().mockResolvedValueOnce({ token: original })
      .mockResolvedValue({ token: refreshed })
    const session = listingSession({ scope: "organization", fetchAstralBeamToken: source }, vi.fn())
    const signal = new AbortController().signal
    const response = Promise.withResolvers<string>()
    const started = Promise.withResolvers<void>()
    const delayed = vi.fn().mockImplementationOnce(() => {
      started.resolve()
      return response.promise
    }).mockResolvedValue("rows")
    const pending = listingRequest(session, signal, delayed)
    await started.promise
    await listingRequest(
      session,
      signal,
      vi.fn().mockRejectedValueOnce(apiError(401)).mockResolvedValue("rows"),
    )
    response.reject(apiError(401))
    await pending
    expect(source).toHaveBeenCalledTimes(2)
    expect(delayed).toHaveBeenLastCalledWith(
      expect.objectContaining({ astralBeamToken: refreshed }),
    )
    disposeListingSession(session)
  })

  test("cancelled requests neither acquire tokens nor report errors to the host", async () => {
    const onError = vi.fn()
    const source = vi.fn(() => Promise.resolve({ token: token() }))
    const session = listingSession({
      scope: "organization",
      fetchAstralBeamToken: source,
      onError,
    }, vi.fn())
    const controller = new AbortController()
    controller.abort()
    await expect(listingRequest(session, controller.signal, vi.fn())).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(source).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    disposeListingSession(session)
  })

  test("resolves exact external IDs without normalizing them and prefers an internal ID", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: [] }))
    const session = listingSession({
      tenantExternalId: " NorthWind ",
      fetchAstralBeamToken: () => Promise.resolve({ token: token() }),
    }, vi.fn())
    const signal = new AbortController().signal
    try {
      expect(await resolveListingTenant(session, signal)).toBeNull()
      expect(new URL(String(fetch.mock.calls[0]![0])).searchParams.get("filter[external_id]"))
        .toBe(" NorthWind ")
      session.options = { ...session.options, tenantId: "internal-id" }
      fetch.mockResolvedValue(Response.json({ id: "internal-id" }))
      expect(await resolveListingTenant(session, signal)).toMatchObject({ id: "internal-id" })
      expect(new URL(String(fetch.mock.calls[1]![0])).pathname).toBe("/api/v1/tenants/internal-id")
    } finally {
      disposeListingSession(session)
      fetch.mockRestore()
    }
  })

  test("loads cursor pages without a framework and rejects users without a selected tenant", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [], page_after: null, page_before: "previous" }),
    )
    const session = listingSession({
      scope: "organization",
      fetchAstralBeamToken: () => Promise.resolve({ token: token() }),
    }, vi.fn())
    const page = {
      kind: "users" as const,
      tenantId: "internal-id",
      q: "a_%",
      admin: "true" as const,
      size: 20,
      cursor: { page_after: "opaque-cursor" },
    }
    const signal = new AbortController().signal
    try {
      expect(await loadListingPage(session, page, signal)).toMatchObject({
        page_before: "previous",
      })
      const url = new URL(String(fetch.mock.calls[0]![0]))
      expect(url.pathname).toBe("/api/v1/tenants/internal-id/tenant_users")
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: "a_%",
        "filter[admin]": "true",
        page_size: "20",
        page_after: "opaque-cursor",
      })
      await expect(loadListingPage(session, { ...page, tenantId: undefined }, signal)).rejects
        .toThrow("Select a tenant")
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      disposeListingSession(session)
      fetch.mockRestore()
    }
  })

  test.each([403, 404, 429])("does not refresh or retry HTTP %s", async (status) => {
    const source = vi.fn(() => Promise.resolve({ token: token() }))
    const session = listingSession({ scope: "organization", fetchAstralBeamToken: source }, vi.fn())
    const request = vi.fn(() => Promise.reject(apiError(status)))
    await expect(listingRequest(session, new AbortController().signal, request)).rejects
      .toMatchObject({ status })
    expect(source).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    disposeChatAuthentication(session.auth)
  })

  test.each([
    token("second@example.com"),
    token("first@example.com", true, "another-organization"),
  ])("clears the renderer before requesting rows under a changed identity", async (nextToken) => {
    const reset = vi.fn()
    const source = vi.fn().mockResolvedValueOnce({ token: token("first@example.com") })
      .mockResolvedValueOnce({
        token: nextToken,
      })
    const session = listingSession({ scope: "organization", fetchAstralBeamToken: source }, reset)
    const request = vi.fn().mockResolvedValueOnce("first rows").mockRejectedValueOnce(apiError(401))
    await listingRequest(session, new AbortController().signal, request)
    await expect(listingRequest(session, new AbortController().signal, request)).rejects
      .toMatchObject({ name: "AbortError" })
    expect(reset).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(2)
    disposeChatAuthentication(session.auth)
  })

  test("aborting or disposing a session cannot deliver a late request", async () => {
    const source = Promise.withResolvers<{ token: string }>()
    const session = listingSession({
      scope: "organization",
      fetchAstralBeamToken: () => source.promise,
    }, vi.fn())
    const request = vi.fn()
    const pending = listingRequest(session, new AbortController().signal, request)
    disposeChatAuthentication(session.auth)
    source.resolve({ token: token() })
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(request).not.toHaveBeenCalled()
  })

  test("scope options never broaden tenant credentials or default organization tokens to all tenants", async () => {
    const request = vi.fn()
    const tenant = listingSession({
      scope: "organization",
      fetchAstralBeamToken: () => Promise.resolve({ token: token("user", false) }),
    }, vi.fn())
    await expect(listingRequest(tenant, new AbortController().signal, request)).rejects.toThrow(
      "Organization mode requires",
    )
    const organization = listingSession(
      { fetchAstralBeamToken: () => Promise.resolve({ token: token() }) },
      vi.fn(),
    )
    await expect(listingRequest(organization, new AbortController().signal, request)).rejects
      .toThrow("tenantId or tenantExternalId is required")
    expect(request).not.toHaveBeenCalled()
    tenant.options.scope = "tenant"
    request.mockResolvedValue("tenant rows")
    await expect(listingRequest(tenant, new AbortController().signal, request))
      .resolves.toBe("tenant rows")
    disposeChatAuthentication(tenant.auth)
    disposeChatAuthentication(organization.auth)
  })

  test.each(["success", "unauthorized"])(
    "discards a late %s response after disposal without refreshing",
    async (result) => {
      const source = vi.fn(() => Promise.resolve({ token: token() }))
      const session = listingSession({
        scope: "organization",
        fetchAstralBeamToken: source,
      }, vi.fn())
      const response = Promise.withResolvers<string>()
      const started = Promise.withResolvers<void>()
      const pending = listingRequest(session, new AbortController().signal, () => {
        started.resolve()
        return response.promise
      })
      await started.promise
      disposeChatAuthentication(session.auth)
      if (result === "unauthorized") response.reject(apiError(401))
      else response.resolve("old rows")
      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(source).toHaveBeenCalledOnce()
    },
  )
})

test("authentication failures notify once even with waiting requests", async () => {
  const onError = vi.fn()
  const failure = new Error("Host session expired")
  const source = Promise.withResolvers<{ token: string }>()
  const session = listingSession(
    { fetchAstralBeamToken: () => source.promise, onError },
    vi.fn(),
  )
  try {
    const authentication = getValidChatAuthToken(session.auth)
    const request = listingRequest(session, new AbortController().signal, vi.fn())
    source.reject(failure)
    await expect(authentication).rejects.toBe(failure)
    await expect(request).rejects.toBe(failure)
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
  } finally {
    disposeListingSession(session)
  }
})
