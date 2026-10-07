import { expect, test } from "vitest"

import { describeError, formatToolJson, transcriptMarkdown } from "./utils.ts"

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

test("copies only user and assistant text as Markdown", () => {
  const markdown = transcriptMarkdown("Plan", [
    { id: "1", role: "user", parts: [{ type: "text", content: "Hi" }] },
    {
      id: "2",
      role: "assistant",
      parts: [
        { type: "thinking", content: "hidden" },
        { type: "text", content: "**Hello**" },
      ],
    },
  ])
  expect(markdown).toBe("# Plan\n\n## User\n\nHi\n\n## Assistant\n\n**Hello**\n")
})
