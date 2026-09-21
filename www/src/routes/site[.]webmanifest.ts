import { createFileRoute } from "@tanstack/react-router"

import { palette } from "@/brand/palette"
import { siteMetadata, siteUrl } from "@/lib/site"

const iconSize = `${siteMetadata.icon.size}x${siteMetadata.icon.size}`
const manifest = {
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
      src: siteUrl(siteMetadata.icon.path),
      sizes: iconSize,
      type: "image/png",
      purpose: "any",
    },
  ],
}

export const Route = createFileRoute("/site.webmanifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(manifest, null, 2), {
          headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
        }),
    },
  },
})
