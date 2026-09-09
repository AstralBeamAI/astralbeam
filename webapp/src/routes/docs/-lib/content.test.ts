import { readdirSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"

import limits from "../-content/sdk/limits.md?raw"
import { DOCS_SECTIONS, docsSitemapPaths } from "./content"
import {
  CHAT_ATTACHMENT_MAX_BYTES_BY_KIND,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS,
  CHAT_MAX_REQUEST_BYTES,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/chat/constants.server"

/** The docs page's own form for a byte cap, so a changed constant reads as a changed page. */
function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`
}

// Drift guard, not a structure test: each documented number is asserted as a substring rendered
// from its constant, so the prose stays the owner's to reword while the values stay pinned.
test("the Limits page quotes the caps the chat endpoint enforces", () => {
  const expected = [
    `limit of ${CHAT_ATTACHMENT_MAX_COUNT} attachments`,
    ...Object.values(CHAT_ATTACHMENT_MAX_BYTES_BY_KIND).map(megabytes),
    megabytes(CHAT_ATTACHMENT_MAX_TOTAL_BYTES),
    megabytes(CHAT_MAX_REQUEST_BYTES),
    `${CHAT_RATE_LIMIT_MAX_REQUESTS} requests per ${CHAT_RATE_LIMIT_WINDOW_MS / 1_000} seconds`,
    `${CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS}–${CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS} seconds`,
  ]
  for (const value of expected) expect(limits).toContain(value)
})

const contentDirectory = new URL("../-content/", import.meta.url)

/** Every Markdown file under -content, keyed as the manifest addresses it: `<section>/<page>.md`. */
function readDocsContentFiles(): Map<string, string> {
  return new Map(
    readdirSync(contentDirectory, { recursive: true }).map(String)
      .filter((entry) => entry.endsWith(".md"))
      .map((entry) => [entry, readFileSync(new URL(entry, contentDirectory), "utf8")]),
  )
}

// DocsMarkdown rewrites a same-folder `./page.md` link to that page's route. A published page may
// only point at another published page, because `findDocsPage` 404s a draft target in production.
test("same-folder Markdown links resolve to a page the same reader can reach", () => {
  const files = readDocsContentFiles()
  for (const section of DOCS_SECTIONS) {
    for (const page of section.pages) {
      const unpublished = Boolean(section.draft || page.draft)
      const reachable = section.pages.filter((entry) => unpublished || !entry.draft)
        .map((entry) => entry.slug)
      const markdown = files.get(`${section.slug}/${page.slug}.md`) ?? ""
      for (const [, target] of markdown.matchAll(/\.\/([\w-]+)\.md/g)) {
        expect(reachable, `${section.slug}/${page.slug} links to ./${target}.md`).toContain(target)
      }
    }
  }
})

// The sitemap is the one place that advertises docs URLs to crawlers, so a draft must not reach it.
test("the sitemap lists the published docs without drafts or redirects", () => {
  const paths = docsSitemapPaths()
  const draftPaths = DOCS_SECTIONS.filter((section) => section.draft)
    .flatMap((section) => section.pages.map((page) => `/docs/${section.slug}/${page.slug}`))

  expect(paths).toContain("/docs")
  expect(paths).toContain("/docs/api")
  expect(paths).toContain("/docs/sdk/getting-started")
  expect(draftPaths.length).toBeGreaterThan(0)
  expect(paths.filter((path) => draftPaths.includes(path))).toEqual([])
  // A bare section URL only redirects to its first page.
  expect(paths).not.toContain("/docs/sdk")
})

test("the manifest and the content directory hold exactly the same pages", () => {
  const files = readDocsContentFiles()
  const registered = DOCS_SECTIONS.flatMap((section) =>
    [...section.pages.map((page) => page.slug), ...Object.keys(section.anchors ?? {})]
      .map((slug) => `${section.slug}/${slug}.md`)
  )
  for (const [file, markdown] of files) {
    expect(registered, `${file} is not registered`).toContain(file)
    expect(markdown.trim(), `${file} is empty`).not.toBe("")
  }
  // An `anchors` slug may have no file, but a registered page whose file is missing would only
  // fail when a reader opened it.
  const pageFiles = DOCS_SECTIONS.flatMap((section) =>
    section.pages.map((page) => `${section.slug}/${page.slug}.md`)
  )
  for (const file of pageFiles) expect([...files.keys()]).toContain(file)
})
