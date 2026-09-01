import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const accessState = vi.hoisted(() => ({
  session: null as null | {
    session: { activeOrganizationId: string | null }
    user: { id: string }
  },
  permissionSuccess: false,
  responseHeader: vi.fn(),
  responseStatus: vi.fn(),
  getSession: vi.fn(),
  hasPermission: vi.fn(),
}))

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/organization/sandbox-providers"),
  setResponseHeader: accessState.responseHeader,
  setResponseStatus: accessState.responseStatus,
}))

vi.mock("@/lib/auth.server", () => ({
  getAuth: () =>
    Promise.resolve({
      api: { getSession: accessState.getSession, hasPermission: accessState.hasPermission },
    }),
}))

import { requireOrganizationConfigurationAccess } from "./organization-configuration-access.server.ts"

describe("organization configuration authorization", () => {
  beforeEach(() => {
    accessState.session = null
    accessState.permissionSuccess = false
    accessState.responseHeader.mockReset()
    accessState.responseStatus.mockReset()
    accessState.getSession.mockReset().mockImplementation(() =>
      Promise.resolve(accessState.session)
    )
    accessState.hasPermission.mockReset().mockImplementation(() =>
      Promise.resolve({ success: accessState.permissionSuccess })
    )
  })

  it("uses the uncached active organization and exact server-side permission", async () => {
    accessState.session = {
      session: { activeOrganizationId: "organization-a" },
      user: { id: "user-a" },
    }
    accessState.permissionSuccess = true

    await expect(Effect.runPromise(requireOrganizationConfigurationAccess("update"))).resolves
      .toEqual({ organizationId: "organization-a" })
    expect(accessState.responseHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(accessState.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    )
    expect(accessState.hasPermission).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        organizationId: "organization-a",
        permissions: { organizationConfiguration: ["update"] },
      },
    }))

    accessState.permissionSuccess = false
    await expect(Effect.runPromise(requireOrganizationConfigurationAccess("read"))).rejects
      .toMatchObject({ status: 403 })
  })
})
