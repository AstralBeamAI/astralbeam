import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { HighlightedCode } from "../components/highlighted-code"
import { highlightCode } from "./highlighter"

function render(code: string, language: string) {
  return highlightCode(code, language)
    .map((line) => renderToStaticMarkup(line))
    .join("\n")
}

test("streaming multiline source is preserved and code is escaped", () => {
  const source =
    'const view = <div title="safe">{`first\nsecond`}</div>\n// <script>alert(1)</script>\n'
  for (let end = 0; end <= source.length; end++) {
    const prefix = source.slice(0, end)
    const html = render(prefix, "tsx")
    expect(html.replace(/<\/?span[^>]*>/g, "")).toBe(
      renderToStaticMarkup(prefix.replace(/\r?\n$/, "")),
    )
  }
  expect(render("/* first\nsecond */", "ts")).toMatch(/th-comment[^>]*>second/)
  expect(render("<script>unsafe</script>", "unknown")).toContain("&lt;script&gt;")
  expect(highlightCode("one\r\n\r\ntwo\r\n", "text")).toHaveLength(3)
})

test("terminal escapes are stripped from rendered code", () => {
  const html = renderToStaticMarkup(
    <HighlightedCode language="ansi">{"\x1b[32mfirst\nsecond\x1b[0m <script>"}</HighlightedCode>,
  )
  expect(html).not.toContain("\x1b")
  expect(html).toContain("first")
  expect(html).toContain("second")
  expect(html).toContain("&lt;script&gt;")
})
