import type { APIRoute } from "astro"

import { siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = siteUrl("/sitemap-index.xml", site?.href)

  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
