import { expect, test } from "vitest"

import { chatPrincipalScope } from "./identity.server"

test("encodes opaque tenant and tenant-user IDs without delimiter collisions", () => {
  const organization = { id: "01990a5d-ac96-774b-b942-6b13c85384ca" }
  const first = chatPrincipalScope({
    organization,
    tenantUser: { id: "user\0suffix", tenant: { id: "tenant" } },
  })
  const second = chatPrincipalScope({
    organization,
    tenantUser: { id: "suffix", tenant: { id: "tenant\0user" } },
  })

  expect(first).not.toBe(second)
})
