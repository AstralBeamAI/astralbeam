import { expect, test } from "vitest"

import { describeError, formatToolJson } from "./utils.ts"

test("explains browser network failures", () => {
  expect(describeError(new TypeError("Failed to fetch"))).toContain("Check your connection")
})

// A host tool may resolve with a cyclic or BigInt-bearing value; the panel must still render.
test("falls back to a string for an unserializable tool payload", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic["self"] = cyclic
  expect(formatToolJson(cyclic)).toBe("[object Object]")
  expect(formatToolJson(1n)).toBe("1")
})
