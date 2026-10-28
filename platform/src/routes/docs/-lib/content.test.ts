import { readdirSync, readFileSync } from "node:fs"
import { expect, test } from "vitest"

import {
  DOCS_SECTIONS,
  docsSitemapEntries,
  findDocsArticleNeighbors,
  type DocsSection,
} from "./content"
const contentDirectory = new URL("../-content/", import.meta.url)

/** Every Markdown file under -content, keyed as the manifest addresses it: `<section>/<page>.md`. */
function readDocsContentFiles(): Map<string, string> {
  return new Map(
    readdirSync(contentDirectory, { recursive: true })
      .map(String)
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
      const reachable = section.pages
        .filter((entry) => unpublished || !entry.draft)
        .map((entry) => entry.slug)
      const markdown = files.get(`${section.slug}/${page.slug}.md`) ?? ""
      for (const [, target] of markdown.matchAll(/\.\/([\w-]+)\.md/g)) {
        expect(reachable, `${section.slug}/${page.slug} links to ./${target}.md`).toContain(target)
      }
    }
  }
})

// The sitemap is the one place that advertises docs URLs to crawlers, so a draft must not reach it.
test("the sitemap lists dated published docs without drafts or redirects", () => {
  const entries = docsSitemapEntries()
  const paths = entries.map((entry) => entry.path)
  const draftPaths = DOCS_SECTIONS.filter((section) => section.draft).flatMap((section) =>
    section.pages.map((page) => `/docs/${section.slug}/${page.slug}`),
  )

  expect(paths).toContain("/docs")
  expect(paths).toContain("/docs/api")
  expect(paths).toContain("/docs/sdk/getting-started")
  expect(paths).toContain("/docs/start/quickstart")
  expect(paths).toContain("/docs/dashboard/agents")
  expect(paths).toContain("/docs/self-hosting/overview")
  expect(paths.filter((path) => draftPaths.includes(path))).toEqual([])
  for (const entry of entries) expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
  // A bare section URL only redirects to its first page.
  expect(paths).not.toContain("/docs/sdk")
})

test("the manifest and the content directory hold exactly the same pages", () => {
  const files = readDocsContentFiles()
  const registered = DOCS_SECTIONS.flatMap((section) =>
    [...section.pages.map((page) => page.slug), ...Object.keys(section.anchors ?? {})].map(
      (slug) => `${section.slug}/${slug}.md`,
    ),
  )
  for (const [file, markdown] of files) {
    expect(registered, `${file} is not registered`).toContain(file)
    expect(markdown.trim(), `${file} is empty`).not.toBe("")
  }
  // An `anchors` slug may have no file, but a registered page whose file is missing would only
  // fail when a reader opened it.
  const pageFiles = DOCS_SECTIONS.flatMap((section) =>
    section.pages.map((page) => `${section.slug}/${page.slug}.md`),
  )
  for (const file of pageFiles) expect([...files.keys()]).toContain(file)
})

const docsNavigationSections: DocsSection[] = [
  {
    slug: "start",
    title: "Start",
    description: "",
    pages: [
      { slug: "overview", title: "Overview", description: "", updated: "2026-01-01" },
      { slug: "draft", title: "Draft", description: "", updated: "2026-01-01", draft: true },
      { slug: "tutorial", title: "Tutorial", description: "", updated: "2026-01-01" },
    ],
  },
  {
    slug: "unpublished",
    title: "Unpublished",
    description: "",
    draft: true,
    pages: [{ slug: "overview", title: "Overview", description: "", updated: "2026-01-01" }],
  },
  {
    slug: "api",
    title: "API",
    description: "",
    href: "/docs/api",
    pages: [{ slug: "overview", title: "Overview", description: "", updated: "2026-01-01" }],
  },
  {
    slug: "sdk",
    title: "SDK",
    description: "",
    pages: [{ slug: "overview", title: "Overview", description: "", updated: "2026-01-01" }],
  },
]

test("article neighbors cross sections while skipping drafts and separate destinations", () => {
  const neighbors = findDocsArticleNeighbors({
    sections: docsNavigationSections,
    sectionSlug: "start",
    pageSlug: "tutorial",
  })

  expect(neighbors).toMatchObject({
    previous: { section: { slug: "start" }, page: { slug: "overview" } },
    next: { section: { slug: "sdk" }, page: { slug: "overview" } },
  })
})

test("article neighbors omit the missing ends and distinguish repeated page slugs", () => {
  const first = findDocsArticleNeighbors({
    sections: docsNavigationSections,
    sectionSlug: "start",
    pageSlug: "overview",
  })
  const last = findDocsArticleNeighbors({
    sections: docsNavigationSections,
    sectionSlug: "sdk",
    pageSlug: "overview",
  })

  expect(first.previous).toBeUndefined()
  expect(first.next?.page.slug).toBe("tutorial")
  expect(last.previous?.page.slug).toBe("tutorial")
  expect(last.next).toBeUndefined()
})

test("an unpublished or unknown article has no navigation neighbors", () => {
  for (const [sectionSlug, pageSlug] of [
    ["start", "draft"],
    ["unpublished", "overview"],
    ["api", "overview"],
    ["start", "missing"],
  ] as const) {
    expect(
      findDocsArticleNeighbors({ sections: docsNavigationSections, sectionSlug, pageSlug }),
    ).toEqual({ previous: undefined, next: undefined })
  }
})
