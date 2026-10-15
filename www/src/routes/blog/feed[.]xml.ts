import { createFileRoute } from "@tanstack/react-router"

import { blogPosts } from "@/lib/blog"
import { siteUrl } from "@/lib/site"

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export const Route = createFileRoute("/blog/feed.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>AstralBeam Blog</title><link>${siteUrl("/blog")}</link>
<description>Notes on building useful agents and their interfaces.</description><language>en-us</language>
<atom:link href="${siteUrl("/blog/feed.xml")}" rel="self" type="application/rss+xml"/>
${blogPosts.map((post) => `<item><title>${escapeXml(post.title)}</title><link>${siteUrl(post.path)}</link><guid>${siteUrl(post.path)}</guid><description>${escapeXml(post.description)}</description><pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate></item>`).join("\n")}
</channel></rss>`,
          { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
        ),
    },
  },
})
