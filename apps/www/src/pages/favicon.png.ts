import { createPngRoute, renderSiteLogo } from "@/lib/site-image"
import { siteMetadata } from "@/lib/site"

export const prerender = true

export const GET = createPngRoute(() => renderSiteLogo(siteMetadata.icon.size))
