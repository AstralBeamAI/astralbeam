import { createFileRoute } from "@tanstack/react-router"

import { resolveAppOrigin } from "@/lib/utils.server"

// Generated rather than a static file because a crawler discovers the sitemap here and the
// Sitemap URL must be absolute. https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = await resolveAppOrigin(request)
        const body = [
          "# https://www.robotstxt.org/robotstxt.html",
          "User-agent: *",
          "Disallow:",
          "",
          `Sitemap: ${origin}/docs/sitemap.xml`,
          "",
        ].join("\n")
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, no-cache",
          },
        })
      },
    },
  },
})
