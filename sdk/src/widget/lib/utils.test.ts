import { expect, test } from "vitest"

import { describeError, formatToolJson } from "./utils.ts"

test("keeps safe server reasons visible and explains network failures", () => {
  const reason = "The model provider rejected its API key. Ask the site owner to update it."
  expect(describeError(new Error(reason))).toBe(reason)
  expect(describeError(new TypeError("Failed to fetch"))).toContain("Check your connection")
})

// A host tool may resolve with a cyclic or BigInt-bearing value; the panel must still render.
test("falls back to a string for an unserializable tool payload", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic["self"] = cyclic
  expect(formatToolJson(cyclic)).toBe("[object Object]")
  expect(formatToolJson(1n)).toBe("1")
})
