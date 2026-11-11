import MiniSearch, { type SearchResult } from "minisearch"
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

export interface DocsSearchResult extends DocsChunk {
  snippet: string
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

function tokenizeDocsQuery(raw: string): string[] {
  const terms = tokenizeDocsSearch(raw)
  // Keep a lone identifier specific, including when wrapped in backticks or parentheses.
  return raw.match(/[\p{L}\p{N}_]+/gu)?.length === 1 ? terms.slice(0, 1) : terms
}

function docsSearchSnippet(text: string, match: SearchResult["match"]): string {
  const terms = new Set(Object.keys(match).filter((term) => match[term]!.includes("text")))
  const word = [...text.matchAll(/[\p{L}\p{N}_]+/gu)].find(([value]) =>
    tokenizeDocsSearch(value).some((term) => terms.has(term)),
  )
  const index = word?.index ?? 0
  const offset = Math.max(0, index - 50)
  const nextSpace = text.indexOf(" ", offset)
  const start = offset && nextSpace >= 0 && nextSpace < index ? nextSpace + 1 : offset
  const limit = Math.min(text.length, start + 180)
  const boundary = text.lastIndexOf(" ", limit)
  const end = limit < text.length && boundary > index + (word?.[0].length ?? 0) ? boundary : limit
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`
}

let docsIndex: Promise<{ search: MiniSearch; chunks: DocsChunk[] }> | undefined

export function loadDocsIndex() {
  docsIndex ??= Promise.all(
    docsPages.map(async (page) => docsChunks(page, await page.load())),
  ).then(
    (pages) => {
      const chunks: DocsChunk[] = pages.flat()
      const search = new MiniSearch({
        fields: ["page", "heading", "text", "path"],
        tokenize: tokenizeDocsSearch,
        searchOptions: {
          tokenize: tokenizeDocsQuery,
          boost: { page: 2, heading: 3, path: 2 },
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

function searchDocsMatches(search: MiniSearch, term: string): SearchResult[] {
  const matches = search.search(term)
  if (tokenizeDocsSearch(term).length > tokenizeDocsQuery(term).length) {
    // Keep whole-identifier matches ahead of related words, without expanding those words further.
    matches.push(
      ...search.search(term, { tokenize: tokenizeDocsSearch, fuzzy: false, prefix: false }),
    )
    return matches
  }
  const identifiers = (term.match(/[\p{L}\p{N}_]+/gu) ?? []).flatMap((word) => {
    const terms = tokenizeDocsSearch(word)
    return terms.length > 1 ? terms.slice(0, 1) : []
  })
  if (!identifiers.length) return matches
  const identifierMatches = new Map(
    search
      .search(identifiers.join(" "), { tokenize: () => identifiers })
      .map((result) => [result.id, result.match]),
  )
  const preferred = matches.flatMap((result) => {
    const match = identifierMatches.get(result.id)
    // Preserve context scores, but center preferred previews on the matching identifier.
    return match ? [{ ...result, match }] : []
  })
  return [...preferred, ...matches]
}

export async function searchDocs(query: string) {
  const term = query.trim().slice(0, 255)
  if (!term) return { results: [] as DocsSearchResult[] }
  const { search, chunks } = await loadDocsIndex()
  const results: DocsSearchResult[] = []
  for (const result of searchDocsMatches(search, term)) {
    const chunk = chunks[result.id as number]!
    if (results.some((each) => each.path === chunk.path)) continue
    results.push({ ...chunk, snippet: docsSearchSnippet(chunk.text, result.match) })
    if (results.length === 5) break
  }
  return { results }
}

export async function readDocsPage(path: string) {
  const page = docsPages.find((candidate) => candidate.path === path)
  if (!page) return { error: `No docs page at ${path}`, paths: docsPages.map((each) => each.path) }
  return { url: page.url, markdown: await page.load() }
}
