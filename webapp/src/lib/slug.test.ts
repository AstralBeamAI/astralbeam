import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"

import { SlugSchema } from "./schemas.ts"
import { generateSlugSuggestion, isValidSlug } from "./slug.ts"

describe("public slugs", () => {
  it("generates a stable lowercase suggestion from injected random bytes", () => {
    expect(generateSlugSuggestion(
      "Production Agent!",
      "agent",
      new Uint8Array([10, 11, 12, 13, 14]),
    )).toBe("productionagentabcde")
    expect(generateSlugSuggestion("***", "org", new Uint8Array([0, 1, 2, 3, 4])))
      .toBe("org01234")
    expect(generateSlugSuggestion("x".repeat(100), "key", new Uint8Array([0, 1, 2, 3, 4])))
      .toHaveLength(63)
  })

  it("uses one strict lowercase-alphanumeric contract", () => {
    expect(isValidSlug("abc019")).toBe(true)
    expect(Schema.is(SlugSchema)("a".repeat(63))).toBe(true)
    expect(Schema.is(SlugSchema)("a".repeat(64))).toBe(false)
    expect(Schema.is(SlugSchema)("ABC")).toBe(false)
    expect(Schema.is(SlugSchema)("with-hyphen")).toBe(false)
    expect(Schema.is(SlugSchema)("with_underscore")).toBe(false)
  })
})
