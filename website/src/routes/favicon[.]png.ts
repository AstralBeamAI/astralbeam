import { createFileRoute } from "@tanstack/react-router"

import { createPngHandler, renderSiteLogo } from "@/lib/site-image"
import { siteMetadata } from "@/lib/site"

export const Route = createFileRoute("/favicon.png")({
  server: {
    handlers: {
      GET: createPngHandler(() => renderSiteLogo(siteMetadata.icon.size)),
    },
  },
})
