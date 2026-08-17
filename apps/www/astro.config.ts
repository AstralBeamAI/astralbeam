import sitemap from "@astrojs/sitemap"
import { workspaceEnvironmentViteConfig } from "@astralbeam/utils/environment"
import { defineConfig } from "astro/config"

import { siteMetadata } from "./src/lib/site.ts"

export default defineConfig({
  site: siteMetadata.origin,
  integrations: [sitemap()],
  vite: workspaceEnvironmentViteConfig,
})
