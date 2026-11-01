import MiniSearch from "minisearch"
import { parseMarkdown, type BlockNode, type InlineNode } from "@tanstack/markdown"
import { docsMarkdownExtensions } from "@tanstack/markdown/extensions/docs"

import { findDocsPage, findDocsSection } from "./content"

// Unlike content.ts, this includes the API guides the OpenAPI description renders. Each page
// stays its own lazy chunk, shared with the docs routes.
const docsMarkdownByPath = import.meta.glob<string>("/src/routes/docs/-content/*/*.md", {
  query: "?raw",
  import: "default",
})

export interface DocsChunk {
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
  const url = section.href ? `${section.href}#${section.anchors![pageSlug]}` : `/docs/${path}`
  return [{ path, url, load, anchors: !section.href }]
})

function docsNodeText(node: BlockNode | InlineNode): string {
  if (node.type === "html" || node.type === "inlineHtml") return ""
  if ("value" in node) return node.value
  if ("children" in node) return node.children.map(docsNodeText).join(" ")
  if ("items" in node) {
    return node.items.flatMap((item) => item.children.map(docsNodeText)).join(" ")
  }
  if (node.type === "table") {
    return [...node.header, ...node.rows.flat()]
      .flatMap((cell) => cell.children.map(docsNodeText))
      .join(" ")
  }
  return node.type === "image" ? node.alt : ""
}

function docsChunks(page: (typeof docsPages)[number], markdown: string): DocsChunk[] {
  const document = parseMarkdown(markdown, { extensions: docsMarkdownExtensions() })
  const title = document.headings?.[0]?.text ?? page.path
  const chunks: DocsChunk[] = []
  let chunk: DocsChunk = { path: page.path, url: page.url, page: title, heading: title, text: "" }
  for (const node of document.children) {
    if (node.type === "heading") {
      if (chunk.text) chunks.push(chunk)
      chunk = {
        path: page.path,
        url: page.anchors && node.depth > 1 && node.id ? `${page.url}#${node.id}` : page.url,
        page: title,
        heading: docsNodeText(node),
        text: "",
      }
    } else {
      chunk.text = `${chunk.text} ${docsNodeText(node)}`.replace(/\s+/g, " ").trim()
    }
  }
  if (chunk.text) chunks.push(chunk)
  return chunks
}

const docsSearchStopWords = new Set(
  "a an and are as at be by can do does for from how i in is it of on or our that the this to use was we what when where which why will with you your".split(
    " ",
  ),
)

function tokenizeDocsSearch(raw: string): string[] {
  return (raw.match(/[\p{L}\p{N}_]+/gu) ?? []).flatMap((token) => {
    const parts = token
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_]+/u)
    // Retain complete identifiers alongside their camelCase and underscore words.
    return (parts.length > 1 ? [token, ...parts] : [token])
      .map((word) => word.normalize("NFKC").toLowerCase())
      .filter((word) => !docsSearchStopWords.has(word))
  })
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
        tokenize: tokenizeDocsSearch,
        searchOptions: {
          boost: { page: 2, heading: 3 },
          prefix: true,
          fuzzy: 0.3,
          maxFuzzy: 2,
        },
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
  const term = query.trim().slice(0, 255)
  if (!term) return { results: [] as DocsChunk[] }
  const { search, chunks } = await loadDocsIndex()
  const results: DocsChunk[] = []
  for (const result of search.search(term)) {
    const chunk = chunks[result.id as number]!
    if (results.some((each) => each.path === chunk.path)) continue
    results.push(chunk)
    if (results.length === 5) break
  }
  return { results }
}

export async function readDocsPage(path: string) {
  const page = docsPages.find((candidate) => candidate.path === path)
  if (!page) return { error: `No docs page at ${path}`, paths: docsPages.map((each) => each.path) }
  return { url: page.url, markdown: await page.load() }
}
