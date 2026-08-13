import { palette } from "@astralbeam/brand"
import type { APIRoute } from "astro"

import { siteMetadata, siteUrl } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.href ?? siteMetadata.origin
  const iconSize = `${siteMetadata.icon.size}x${siteMetadata.icon.size}`

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
        background_color: palette.dark.background.srgbHex,
        theme_color: palette.dark.background.srgbHex,
        icons: [
          {
            src: siteUrl(siteMetadata.icon.path, baseUrl),
            sizes: iconSize,
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } },
  )
}
