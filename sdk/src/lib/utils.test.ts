import { expect, test } from "vitest"

import { formatToolJson } from "./utils.ts"

test("formats a tool payload as indented JSON", () => {
  expect(formatToolJson({ city: "Bengaluru", days: [1, 2] })).toBe(
    '{\n  "city": "Bengaluru",\n  "days": [\n    1,\n    2\n  ]\n}',
  )
})

test("returns an empty string for a payload with nothing to show", () => {
  expect(formatToolJson(undefined)).toBe("")
})

// A host tool may resolve with a cyclic or BigInt-bearing value; the panel must still render.
test("falls back to a string for an unserializable tool payload", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic["self"] = cyclic
  expect(formatToolJson(cyclic)).toBe("[object Object]")
  expect(formatToolJson(1n)).toBe("1")
})
