import { createFileRoute } from "@tanstack/react-router"

import { siteUrl } from "@/lib/site"

// The canonical URL of every indexable page. /404 is deliberately absent.
const indexablePaths = ["/", "/terms", "/privacy"]

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const entries = indexablePaths
          .map((path) => `  <url><loc>${siteUrl(path)}</loc></url>`)
          .join("\n")
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } },
        )
      },
    },
  },
})
