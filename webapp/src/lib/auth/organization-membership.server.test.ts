import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { beforeEach, describe, expect, it, vi } from "vitest"

const accessState = vi.hoisted(() => ({
  session: null as null | {
    session: { activeOrganizationId: string | null }
    user: { id: string }
  },
  membership: null as null | {
    organizationId: string
    organizationSlug: string
    organizationName: string
    role: string
  },
  responseHeader: vi.fn(),
  responseStatus: vi.fn(),
  getSession: vi.fn(),
  setActiveOrganization: vi.fn(),
  readOrganizationMembership: vi.fn(),
}))

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/acme/sandboxes"),
  setResponseHeader: accessState.responseHeader,
  setResponseStatus: accessState.responseStatus,
}))

vi.mock("@/lib/auth.server", () => ({
  getAuth: () =>
    Promise.resolve({
      api: {
        getSession: accessState.getSession,
        setActiveOrganization: accessState.setActiveOrganization,
      },
    }),
}))

vi.mock("@/db/organization.server", () => ({
  readOrganizationMembership: accessState.readOrganizationMembership,
}))

import { type EffectDatabase, effectDatabase } from "@/db"
import {
  requireOrganizationAccess,
  resolveOrganizationRouteAccess,
} from "./organization-membership.server.ts"

// The membership read is mocked, so the service only has to satisfy the requirement type.
const databaseLayer = Layer.succeed(effectDatabase, {} as EffectDatabase)

function runAccess<Value, Error>(
  effect: Effect.Effect<Value, Error, typeof effectDatabase.Identifier>,
): Promise<Value> {
  return Effect.runPromise(Effect.provide(effect, databaseLayer))
}

const OWNER_MEMBERSHIP = {
  organizationId: "organization-a",
  organizationSlug: "acme",
  organizationName: "Acme Inc",
  role: "owner",
}

describe("organization membership authorization", () => {
  beforeEach(() => {
    accessState.session = { session: { activeOrganizationId: null }, user: { id: "user-a" } }
    accessState.membership = OWNER_MEMBERSHIP
    accessState.responseHeader.mockReset()
    accessState.responseStatus.mockReset()
    accessState.getSession.mockReset().mockImplementation(() =>
      Promise.resolve(accessState.session)
    )
    accessState.setActiveOrganization.mockReset().mockResolvedValue({ id: "organization-a" })
    accessState.readOrganizationMembership.mockReset().mockImplementation(() =>
      Effect.succeed(accessState.membership)
    )
  })

  it("derives the organization and its permissions from the slug input alone", async () => {
    await expect(
      runAccess(
        requireOrganizationAccess({
          data: { organizationSlug: "acme", organizationId: "organization-forged" },
          permissions: { organizationConfiguration: ["update"] },
        }),
      ),
    ).resolves.toMatchObject({
      organizationId: "organization-a",
      organizationSlug: "acme",
      role: "owner",
      permissions: { updateConfiguration: true },
    })
    expect(accessState.responseHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(accessState.readOrganizationMembership).toHaveBeenCalledWith({
      organizationSlug: "acme",
      userId: "user-a",
    })
    // A forged organization ID in the payload must never reach the membership read.
    expect(accessState.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    )
  })

  it("denies an insufficient role and a missing membership without revealing existence", async () => {
    accessState.membership = { ...OWNER_MEMBERSHIP, role: "viewer" }
    await expect(
      runAccess(
        requireOrganizationAccess({
          data: { organizationSlug: "acme" },
          permissions: { organizationConfiguration: ["read"] },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 })

    accessState.membership = null
    await expect(
      runAccess(requireOrganizationAccess({ data: { organizationSlug: "acme" } })),
    ).rejects.toMatchObject({ status: 404 })
    await expect(runAccess(resolveOrganizationRouteAccess("acme"))).resolves.toBeNull()
    expect(accessState.setActiveOrganization).not.toHaveBeenCalled()
  })

  it("points the session's active organization at the URL organization", async () => {
    accessState.session = {
      session: { activeOrganizationId: "organization-b" },
      user: { id: "user-a" },
    }

    await expect(runAccess(resolveOrganizationRouteAccess("acme"))).resolves.toMatchObject({
      organizationId: "organization-a",
    })
    expect(accessState.setActiveOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ body: { organizationId: "organization-a" } }),
    )
  })
})
