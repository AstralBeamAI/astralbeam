import { expect, test } from "vitest"
import { deriveOrganizationPermissions, type OrganizationAccess } from "@/lib/organizations/access"
import { agentDestination } from "./dogfood-chat"

const navigationOrganization: OrganizationAccess = {
  organizationId: "01990a5d-0000-7000-8000-000000000011",
  organizationSlug: "acme",
  organizationName: "Acme",
  role: "owner",
  permissions: deriveOrganizationPermissions("owner"),
}

test("navigation refuses arbitrary paths and agents in another organization", () => {
  expect(() =>
    agentDestination(navigationOrganization, { section: "models", id: "../../configure" }),
  ).toThrow()
  expect(() =>
    agentDestination(navigationOrganization, {
      section: "agents",
      id: "agent_01990a5d-0000-7000-8000-000000000012_01990a5d-0000-7000-8000-000000000003",
    }),
  ).toThrow()
  expect(() =>
    agentDestination(navigationOrganization, { section: "tenants", id: "new" }),
  ).toThrow()
})

test("viewer navigation matches the existing dashboard permissions", () => {
  const viewer = {
    ...navigationOrganization,
    role: "viewer",
    permissions: deriveOrganizationPermissions("viewer"),
  }
  expect(agentDestination(viewer, { section: "tenants" }).path).toBe("/acme/tenants")
  for (const section of ["agents", "models", "sandboxes", "api-keys", "settings"] as const) {
    expect(() => agentDestination(viewer, { section })).toThrow()
  }
})
