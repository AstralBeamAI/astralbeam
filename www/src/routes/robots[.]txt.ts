import { createFileRoute } from "@tanstack/react-router"

import { siteUrl } from "@/lib/site"

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(`User-agent: *\nAllow: /\n\nSitemap: ${siteUrl("/sitemap.xml")}\n`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
})
