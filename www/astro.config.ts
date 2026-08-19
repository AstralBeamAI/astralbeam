import sitemap from "@astrojs/sitemap"
import { defineConfig } from "astro/config"

import { siteMetadata } from "./src/lib/site.ts"

export default defineConfig({
  site: siteMetadata.origin,
  integrations: [sitemap()],
})
