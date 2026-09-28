import { createFileRoute } from "@tanstack/react-router"

import { resolveAppOrigin } from "@/lib/utils.server"
import {
  DOCS_SECTIONS,
  findDocsArticleNeighbors,
  findDocsPage,
  findDocsSection,
  loadDocsMarkdown,
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
        const { previous, next } = findDocsArticleNeighbors({
          sections: DOCS_SECTIONS,
          sectionSlug: section.slug,
          pageSlug: page.slug,
        })
        const link = (label: string, entry: typeof previous) =>
          entry &&
          `- ${label}: [${entry.section.title}: ${entry.page.title}](${origin}/docs/${entry.section.slug}/${entry.page.slug}.md)`
        const footer = [
          `- Parent: [Documentation index](${origin}/docs.md)`,
          link("Previous", previous),
          link("Next", next),
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
