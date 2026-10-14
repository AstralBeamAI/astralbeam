import { expect, test } from "vitest"

import { describeError, formatToolJson, transcriptMarkdown } from "./utils.ts"

test("explains browser network failures", () => {
  expect(describeError(new TypeError("Failed to fetch"))).toContain("Check your connection")
})

test("names a reached usage limit and when chat resumes, instead of the raw problem detail", () => {
  const body = {
    type: "about:blank",
    title: "Too Many Requests",
    status: 429,
    detail: "Weekly limit reached. It resets at 2026-10-19T00:00:00.000Z.",
    usage_limit: { name: "Weekly limit", resets_at: "2026-10-19T00:00:00.000Z" },
  }
  const error = Object.assign(new Error(body.detail), {
    name: "AstralBeamApiError",
    status: 429,
    headers: new Headers(),
    body,
  })
  expect(describeError(error)).toMatch(/^Weekly limit reached\. You can chat again after .*2026/)
})

// A host tool may resolve with a cyclic or BigInt-bearing value; the panel must still render.
test("falls back to a string for an unserializable tool payload", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic["self"] = cyclic
  expect(formatToolJson(cyclic)).toBe("[object Object]")
  expect(formatToolJson(1n)).toBe("1")
})

test("copies only user and assistant text as Markdown", () => {
  const answer = {
    type: "text" as const,
    content: "**Hello**",
    metadata: {
      web: {
        sources: [],
        citations: [
          { url: "https://example.com", title: "Example", startIndex: 0, endIndex: 9, number: 1 },
        ],
      },
    },
  }
  const markdown = transcriptMarkdown("Plan", [
    { id: "1", role: "user", parts: [{ type: "text", content: "Hi" }] },
    {
      id: "2",
      role: "assistant",
      parts: [{ type: "thinking", content: "hidden" }, answer],
    },
  ])
  expect(markdown).toBe(
    '# Plan\n\n## User\n\nHi\n\n## Assistant\n\n**Hello** [1](<https://example.com/> "Example")\n',
  )
})
