import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"

import { generateSlugSuggestion, isValidSlug, SlugSchema } from "./slug.ts"

describe("public slugs", () => {
  it("suggests the name's words joined by hyphens, blank without any", () => {
    expect(generateSlugSuggestion(" Acme  Logistics, Inc.")).toBe("acme-logistics-inc")
    expect(generateSlugSuggestion("***")).toBe("")
    expect(generateSlugSuggestion(`${"x".repeat(62)} y`)).toBe("x".repeat(62))
  })

  it("uses one strict lowercase alphanumeric and hyphen contract", () => {
    expect(isValidSlug("abc019")).toBe(true)
    expect(isValidSlug("with-hyphen")).toBe(true)
    expect(Schema.is(SlugSchema)("a".repeat(63))).toBe(true)
    expect(Schema.is(SlugSchema)("a".repeat(64))).toBe(false)
    expect(Schema.is(SlugSchema)("ABC")).toBe(false)
    expect(Schema.is(SlugSchema)("with_underscore")).toBe(false)
  })
})
