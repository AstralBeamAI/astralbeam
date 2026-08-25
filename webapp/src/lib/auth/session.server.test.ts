import { beforeEach, describe, expect, test, vi } from "vitest"
import { authQueryKeys } from "@better-auth-ui/core"
import { QueryClient } from "@tanstack/react-query"

type TestSession = {
  session: { activeOrganizationId: string | null }
  user: { id: string }
} | null

const mocks = vi.hoisted(() => ({
  getRequest: vi.fn(() => new Request("https://app.example.test/")),
  getSession: vi.fn((): Promise<TestSession> => Promise.resolve(null)),
  ensureSessionServer: vi.fn(
    (): Promise<TestSession> => Promise.resolve(null),
  ),
  listOrganizations: vi.fn(
    (): Promise<Array<{ id: string }>> => Promise.resolve([]),
  ),
  setActiveOrganization: vi.fn(),
  setResponseHeader: vi.fn(),
}))

vi.mock("@better-auth-ui/core/server", () => ({
  ensureSessionServer: mocks.ensureSessionServer,
}))

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.getRequest,
  setResponseHeader: mocks.setResponseHeader,
}))

vi.mock("@/lib/auth.server", () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      listOrganizations: mocks.listOrganizations,
      setActiveOrganization: mocks.setActiveOrganization,
    },
  },
}))

import { getSessionAccessDecisionForRequest } from "@/lib/auth/session.server"

describe("session access response boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("marks the session-derived decision as private before resolving access", async () => {
    await expect(getSessionAccessDecisionForRequest()).resolves.toEqual({
      status: "signed-out",
    })

    expect(mocks.setResponseHeader).toHaveBeenNthCalledWith(
      1,
      "Cache-Control",
      "no-store",
    )
    expect(mocks.setResponseHeader).toHaveBeenNthCalledWith(
      2,
      "Vary",
      "Cookie, Authorization",
    )
  })

  test("seeds the shared session query during server-side route resolution", async () => {
    const queryClient = new QueryClient()
    mocks.ensureSessionServer.mockResolvedValueOnce({
      session: { activeOrganizationId: "organization-a" },
      user: { id: "user-a" },
    })
    mocks.listOrganizations.mockResolvedValueOnce([{ id: "organization-a" }])

    await expect(
      getSessionAccessDecisionForRequest(queryClient),
    ).resolves.toEqual({
      status: "ready",
      userId: "user-a",
      organizationId: "organization-a",
    })

    expect(mocks.ensureSessionServer).toHaveBeenCalledOnce()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  test("keeps a repaired active organization consistent in the hydrated session", async () => {
    const queryClient = new QueryClient()
    mocks.ensureSessionServer.mockResolvedValueOnce({
      session: { activeOrganizationId: null },
      user: { id: "user-a" },
    })
    mocks.listOrganizations.mockResolvedValueOnce([{ id: "organization-a" }])
    mocks.setActiveOrganization.mockResolvedValueOnce({ id: "organization-a" })

    await expect(
      getSessionAccessDecisionForRequest(queryClient),
    ).resolves.toEqual({
      status: "ready",
      userId: "user-a",
      organizationId: "organization-a",
    })

    expect(queryClient.getQueryData(authQueryKeys.session)).toEqual({
      session: { activeOrganizationId: "organization-a" },
      user: { id: "user-a" },
    })
  })

  test("logs and returns only a generic access failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.getSession.mockRejectedValueOnce(
      new Error("postgres://user:secret@example.test/database"),
    )

    await expect(getSessionAccessDecisionForRequest()).rejects.toThrow(
      "Unable to determine organization access",
    )

    expect(log).toHaveBeenCalledWith(
      "Unable to determine organization access",
      "Error",
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret")
    log.mockRestore()
  })
})
