import type { MDXProps } from "mdx/types"
import type { ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"

import { markdownComponents } from "../src/routes/blog/-components/markdown"

const fixtures = import.meta.glob<{
  default: ComponentType<MDXProps>
  frontmatter: { title: string }
  readingTime: { minutes: number }
}>("./fixtures/*.md", { eager: true })

test("compiles Markdown metadata and demos while retaining URL and HTML safety", () => {
  const { default: Content, frontmatter, readingTime } = fixtures["./fixtures/markdown.md"]!
  const html = renderToStaticMarkup(<Content components={markdownComponents} />)

  expect(frontmatter.title).toBe("Markdown compiler contract")
  expect(readingTime.minutes).toBeGreaterThan(0)
  expect(html).toContain("Literal {braces}")
  expect(html).toContain('aria-label="Simulation: The duplicate action"')
  expect(html).toContain('href="https://example.com/?first=1&amp;second=2"')
  expect(html).toContain('target="_blank" rel="noopener noreferrer"')
  expect(html).not.toMatch(/unsafeHtml|data:text|data:image|language-demo/u)
})
