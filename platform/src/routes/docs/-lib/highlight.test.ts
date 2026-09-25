import { expect, test } from "vitest"

import { docsHighlightMarkdownCode } from "./highlight"

test("docs highlighter tokenizes typescript and shell", () => {
  const ts = docsHighlightMarkdownCode("const n = 1\n", "ts")
  expect(ts).toContain("th-keyword")
  expect(ts).toContain("const")

  const sh = docsHighlightMarkdownCode("deno task dev\n", "sh")
  expect(sh).toContain("deno")
})
