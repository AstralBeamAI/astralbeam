import { fileURLToPath } from "node:url"

import sitemap from "@astrojs/sitemap"
import { defineConfig } from "astro/config"

import { siteMetadata } from "./src/lib/site.ts"

const workspaceDirectory = fileURLToPath(new URL("../", import.meta.url))

export default defineConfig({
  site: siteMetadata.origin,
  integrations: [sitemap()],
  vite: {
    // The development licenses route imports repository-level files. https://vite.dev/config/server-options.html#server-fs-allow
    server: { fs: { allow: [workspaceDirectory] } },
  },
})
