import { createFileRoute } from "@tanstack/react-router"

import { resolveAppOrigin } from "@/lib/utils.server"
import {
  DOCS_SECTIONS,
  findDocsPage,
  findDocsSection,
  loadDocsMarkdown,
  publishedDocsPages,
} from "../../-lib/content"

// Serves a page's Markdown source with a footer linking the index and its navigation neighbors.
// An index route, since the router ranks the `$page/` index above an equally specific suffix match.
export const Route = createFileRoute("/docs/$section/{$page}.md/")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const section = findDocsSection(params.section)
        const page = section && !section.href ? findDocsPage(section, params.page) : undefined
        if (!section || !page) return new Response("Not found\n", { status: 404 })
        const origin = await resolveAppOrigin(request)
        const entries = DOCS_SECTIONS.filter((entry) => !entry.draft && !entry.href).flatMap(
          (entry) =>
            publishedDocsPages(entry).map((article) => ({ section: entry, page: article })),
        )
        const position = entries.findIndex((entry) => entry.page === page)
        const link = (label: string, entry: (typeof entries)[number] | undefined) =>
          entry &&
          `- ${label}: [${entry.section.title}: ${entry.page.title}](${origin}/docs/${entry.section.slug}/${entry.page.slug}.md)`
        const footer = [
          `- Parent: [Documentation index](${origin}/docs.md)`,
          link("Previous", entries[position - 1]),
          link("Next", entries[position + 1]),
        ].filter(Boolean)
        const markdown = await loadDocsMarkdown(section.slug, page.slug)
        return new Response(`${markdown.trimEnd()}\n\n---\n\n${footer.join("\n")}\n`, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, no-cache",
          },
        })
      },
    },
  },
})
