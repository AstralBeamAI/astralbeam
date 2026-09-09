import { readdirSync } from "node:fs"
import { expect, test } from "vitest"

import limits from "../-content/sdk/limits.md?raw"
import { DOCS_SECTIONS } from "./content"
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

// DocsMarkdown rewrites a same-folder `./page.md` link to that page's route, which 404s in
// production if the page was renamed or unregistered.
test("every same-folder Markdown link resolves to a page in the same section", () => {
  for (const section of DOCS_SECTIONS) {
    const slugs = section.pages.map((page) => page.slug)
    for (const page of section.pages) {
      for (const [, target] of page.markdown.matchAll(/\.\/([\w-]+)\.md/g)) {
        expect(slugs, `${section.slug}/${page.slug} links to ./${target}.md`).toContain(target)
      }
    }
  }
})

test("every content file is registered in the manifest with non-empty Markdown", () => {
  const registered = DOCS_SECTIONS.flatMap((section) =>
    [...section.pages.map((page) => page.slug), ...Object.keys(section.anchors ?? {})]
      .map((slug) => `${section.slug}/${slug}.md`)
  )
  const files = readdirSync(new URL("../-content", import.meta.url), { recursive: true })
    .map(String).filter((entry) => entry.endsWith(".md"))
  for (const file of files) expect(registered).toContain(file)
  for (const section of DOCS_SECTIONS) {
    for (const page of section.pages) {
      expect(page.markdown.trim(), `${section.slug}/${page.slug}`).not.toBe("")
    }
  }
})
