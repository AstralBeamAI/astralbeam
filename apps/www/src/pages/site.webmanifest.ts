import type { APIRoute } from "astro"

import { siteMetadata, siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.href ?? siteMetadata.origin

  return new Response(
    JSON.stringify(
      {
        id: "/",
        name: siteMetadata.name,
        short_name: siteMetadata.name,
        description: siteMetadata.description,
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: siteMetadata.themeColor,
        theme_color: siteMetadata.themeColor,
        icons: [
          { src: siteUrl("/favicon.png", baseUrl), sizes: "160x160", type: "image/png" },
          {
            src: siteUrl("/icon-512.png", baseUrl),
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } },
  )
}
