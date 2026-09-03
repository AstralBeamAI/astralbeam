import { describe, expect, test } from "vitest"

import { prepareOrganizationApiKeyInsert } from "./organization-hooks.server.ts"

describe("organization API key insert", () => {
  test("moves the transient slug metadata into its column", () => {
    expect(prepareOrganizationApiKeyInsert({
      prefix: "abo_",
      metadata: { slug: "production-key" },
    })).toEqual({
      prefix: "abo_",
      metadata: null,
      slug: "production-key",
    })
  })

  test.each([
    { prefix: "abo_", metadata: undefined },
    { prefix: "abo_", metadata: { slug: "invalid_slug" } },
    { prefix: "abo_", metadata: { slug: "production", extra: true } },
    { prefix: "other_", metadata: { slug: "production" } },
  ])("rejects invalid creation data", (data) => {
    expect(() => prepareOrganizationApiKeyInsert(data)).toThrow("API key identifier is invalid")
  })
})
