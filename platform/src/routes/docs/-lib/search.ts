import MiniSearch from "minisearch"

import { findDocsPage, findDocsSection } from "./content"

// Unlike content.ts, this includes the API guides the OpenAPI description renders. Each page
// stays its own lazy chunk, shared with the docs routes.
const docsMarkdownByPath = import.meta.glob<string>("/src/routes/docs/-content/*/*.md", {
  query: "?raw",
  import: "default",
})

interface DocsChunk {
  path: string
  url: string
  page: string
  heading: string
  text: string
}

const docsPages = Object.entries(docsMarkdownByPath).flatMap(([file, load]) => {
  const [, sectionSlug = "", pageSlug = ""] = /-content\/([^/]+)\/([^/]+)\.md$/.exec(file) ?? []
  const section = findDocsSection(sectionSlug)
  if (!section || !(findDocsPage(section, pageSlug) || section.anchors?.[pageSlug])) return []
  const path = `${sectionSlug}/${pageSlug}`
  return [{ path, url: `/docs/${path}`, load }]
})

/** Splits a page at its `##` headings, outside code fences, into searchable chunks. */
function docsChunks(page: (typeof docsPages)[number], markdown: string) {
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? page.path
  const sections = [{ heading: title, lines: [] as string[] }]
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    if (!fenced && line.startsWith("## ")) sections.push({ heading: line.slice(3), lines: [] })
    else sections.at(-1)!.lines.push(line)
  }
  return sections.map(({ heading, lines }) => ({
    path: page.path,
    url: page.url,
    page: title,
    heading,
    text: lines.join("\n").trim(),
  }))
}

let docsIndex: Promise<{ search: MiniSearch; chunks: DocsChunk[] }> | undefined

function loadDocsIndex() {
  docsIndex ??= Promise.all(
    docsPages.map(async (page) => docsChunks(page, await page.load())),
  ).then(
    (pages) => {
      const chunks: DocsChunk[] = pages.flat()
      const search = new MiniSearch({
        fields: ["page", "heading", "text"],
        searchOptions: { boost: { heading: 3, page: 2 }, prefix: true, fuzzy: 0.2 },
      })
      search.addAll(chunks.map((chunk, id) => ({ id, ...chunk })))
      return { search, chunks }
    },
    (error: unknown) => {
      // Let the next call retry a chunk that failed to load.
      docsIndex = undefined
      throw error
    },
  )
  return docsIndex
}

export async function searchDocs(query: string) {
  const { search, chunks } = await loadDocsIndex()
  return {
    results: search
      .search(query)
      .slice(0, 5)
      .map((result) => chunks[result.id as number]!),
  }
}

export async function readDocsPage(path: string) {
  const page = docsPages.find((candidate) => candidate.path === path)
  if (!page) return { error: `No docs page at ${path}`, paths: docsPages.map((each) => each.path) }
  return { url: page.url, markdown: await page.load() }
}
