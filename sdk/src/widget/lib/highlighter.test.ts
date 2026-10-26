import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { highlightCode } from "./highlighter"

function render(code: string, language: string) {
  return highlightCode(code, language)
    .map((line) => renderToStaticMarkup(line))
    .join("\n")
}

test("streaming multiline source survives every prefix, replacements, and language changes", () => {
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
  expect(render("return 1", "TS")).toContain("th-keyword")
  expect(render("<script>unsafe</script>", "unknown")).not.toContain("th-")
  expect(render("<script>unsafe</script>", "unknown")).toContain("&lt;script&gt;")
  expect(highlightCode("one\r\n\r\ntwo\r\n", "text")).toHaveLength(3)
})

test.each([
  ["js", "const value = true"],
  ["typescript", "const value: number = 1"],
  ["jsx", "const view = <div />"],
  ["css", "body { color: red; }"],
  ["html", "<div>hello</div>"],
  ["json", '{"value": true}'],
  ["md", "# Heading"],
  ["py", "def example(): return True"],
  ["sql", "SELECT * FROM users"],
  ["yml", "key: true"],
  ["shellscript", "export VALUE=1"],
  ["diff", "+added"],
  ["ruby", "class Example\nend"],
])("retains syntax coloring for %s", (language, source) => {
  expect(render(source, language)).toContain('class="th-')
})

test("ANSI colors span lines and reset, with truecolor, backgrounds and decorations", () => {
  const html = render(
    "\x1b[32mfirst\nsecond\x1b[0m plain\n\x1b[1;3;4;9;38;2;12;34;56;48;5;196m<script>\x1b[0m",
    "ANSI",
  )
  expect(html.match(/light-dark\(#28a745, #34d058\)/g)).toHaveLength(2)
  expect(html).toContain('color:var(--th-token)"> plain')
  expect(html).toContain(
    "color:#0c2238;background-color:#ff0000;font-weight:bold;font-style:italic;text-decoration:underline line-through",
  )
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("\x1b")
  expect(render("plain", "ansi")).not.toContain("light-dark")
  expect(render("\x1b[7mreverse\x1b[0m", "ansi")).toContain(
    "color:var(--th-background);background-color:var(--th-token)",
  )
  expect(render("\x1b[2;31mdim", "ansi")).toContain("color-mix")
})
