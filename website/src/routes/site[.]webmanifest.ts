import { createFileRoute } from "@tanstack/react-router"

import astralbeamLightLogoUrl from "@/assets/astralbeam-logo-light.svg?url&no-inline"
import { palette } from "@/brand/palette"
import { siteMetadata } from "@/lib/site"

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
      src: astralbeamLightLogoUrl,
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any",
    },
  ],
}

export const Route = createFileRoute("/site.webmanifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(manifest, null, 2), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        }),
    },
  },
})
