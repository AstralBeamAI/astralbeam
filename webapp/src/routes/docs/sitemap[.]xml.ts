import { createFileRoute } from "@tanstack/react-router"

import { resolveAppOrigin } from "@/lib/utils.server"
import { docsSitemapPaths } from "./-lib/content"

// A sitemap may only list URLs at or below its own path, so the docs sitemap lives under /docs.
// https://www.sitemaps.org/protocol.html#location
export const Route = createFileRoute("/docs/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = await resolveAppOrigin(request)
        const entries = docsSitemapPaths()
          .map((path) => `  <url><loc>${origin}${path}</loc></url>`)
          .join("\n")
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "public, no-cache",
            },
          },
        )
      },
    },
  },
})
