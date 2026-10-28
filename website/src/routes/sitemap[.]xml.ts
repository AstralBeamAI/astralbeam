import { createFileRoute } from "@tanstack/react-router"

import { blogPosts } from "@/lib/blog"
import { landingUpdated, siteUrl } from "@/lib/site"

// The canonical URL of every indexable page. /404 is deliberately absent.
const indexablePages = [
  { path: "/", lastmod: landingUpdated },
  { path: "/terms", lastmod: "2026-09-21" },
  { path: "/privacy", lastmod: "2026-10-17" },
  { path: "/blog", lastmod: blogPosts[0]!.date },
  ...blogPosts.map((post) => ({ path: post.path, lastmod: post.date })),
]

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const entries = indexablePages
          .map(
            ({ path, lastmod }) =>
              `  <url><loc>${siteUrl(path)}</loc><lastmod>${lastmod}</lastmod></url>`,
          )
          .join("\n")
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          },
        )
      },
    },
  },
})
