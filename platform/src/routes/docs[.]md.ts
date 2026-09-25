import { createFileRoute } from "@tanstack/react-router"

import { APP_NAME } from "@/lib/constants"
import { resolveAppOrigin } from "@/lib/utils.server"
import { DOCS_SECTIONS, publishedDocsPages } from "./docs/-lib/content"

// The Markdown counterpart of /docs, listing every published page's .md URL in navigation order.
export const Route = createFileRoute("/docs.md")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = await resolveAppOrigin(request)
        const sections = DOCS_SECTIONS.filter((section) => !section.draft).map((section) => {
          const links = section.href
            ? [`- [OpenAPI document](${origin}/api/openapi.json)`]
            : publishedDocsPages(section).map(
                (page) => `- [${page.title}](${origin}/docs/${section.slug}/${page.slug}.md)`,
              )
          return `## ${section.title}\n\n${section.description}\n\n${links.join("\n")}`
        })
        return new Response(
          `# ${APP_NAME} documentation\n\nGuides for building on ${APP_NAME}.\n\n${sections.join("\n\n")}\n`,
          {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Cache-Control": "public, no-cache",
            },
          },
        )
      },
    },
  },
})
