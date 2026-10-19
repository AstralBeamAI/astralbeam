import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, test, vi } from "vitest"

import { deriveOrganizationPermissions } from "@/lib/organizations/access"
import { invalidateOrganizationPages, organizationPageLoader } from "./page-query"

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
  const context = {
    queryClient,
    access: { userId: "user-a" },
    organization: {
      organizationId: "organization-a",
      organizationSlug: "acme",
      organizationName: "Acme",
      memberId: "member-a",
      avatarFileId: null,
      role: "owner",
      permissions: deriveOrganizationPermissions("owner"),
    },
  }
  const load = vi.fn(() => Promise.resolve({ name: "Original" }))
  const { handler } = organizationPageLoader("agents", load)
  return { context, load, read: () => handler({ context, params: { orgSlug: "acme" } }) }
}

afterEach(() => vi.useRealTimers())

describe("organization page queries", () => {
  test("reuses fresh data, refreshes after mutation invalidation, and expires after 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { context, load, read } = setup()
    await read()
    await read()
    expect(load).toHaveBeenCalledTimes(1)

    load.mockResolvedValue({ name: "Updated" })
    await invalidateOrganizationPages(context.queryClient, "organization-a")
    expect(await read()).toEqual({ name: "Updated" })
    expect(load).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + 30_001)
    await read()
    expect(load).toHaveBeenCalledTimes(3)
    context.queryClient.clear()
  })

  test("cancels an older preload before invalidating after a mutation", async () => {
    const { context, load, read } = setup()
    const pending = Promise.withResolvers<{ name: string }>()
    load.mockReturnValueOnce(pending.promise)
    const beforeMutation = read().catch(() => undefined)

    await invalidateOrganizationPages(context.queryClient, "organization-a")
    pending.resolve({ name: "Outdated" })
    expect(await beforeMutation).toBeUndefined()

    load.mockResolvedValue({ name: "Updated" })
    expect(await read()).toEqual({ name: "Updated" })
    expect(load).toHaveBeenCalledTimes(2)
    context.queryClient.clear()
  })

  test.each(["user", "organization", "membership", "role", "permission"])(
    "does not reuse data after the %s changes",
    async (changed) => {
      const { context, load, read } = setup()
      await read()
      if (changed === "user") context.access.userId = "user-b"
      if (changed === "organization") context.organization.organizationId = "organization-b"
      if (changed === "membership") context.organization.memberId = "member-b"
      if (changed === "role") context.organization.role = "developer"
      if (changed === "permission") {
        context.organization.permissions = {
          ...context.organization.permissions,
          updateConfiguration: false,
        }
      }
      await read()
      expect(load).toHaveBeenCalledTimes(2)
      context.queryClient.clear()
    },
  )
})
