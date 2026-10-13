import { expect, test } from "vitest"
import { citedWebText, safeWebUrl } from "./web"

test("citations retain answer text and use safe numbered links", () => {
  const citation = {
    url: "https://example.com/page",
    title: "Example",
    startIndex: 0,
    endIndex: 6,
    number: 2,
  }
  expect(citedWebText("Answer", [citation])).toBe(
    'Answer [2](<https://example.com/page> "Example")',
  )
  expect(citedWebText("Answer", [{ ...citation, url: "javascript:alert(1)" }])).toBe("Answer")
  expect(safeWebUrl("https://user:password@example.com")).toBeUndefined()
})
