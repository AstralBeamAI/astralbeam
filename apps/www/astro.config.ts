import { fileURLToPath } from "node:url"

import sitemap from "@astrojs/sitemap"
import { defineConfig } from "astro/config"

import { siteMetadata } from "./src/lib/site.ts"

// Astro projects don't inherit the root's Vite config, so point it at the repository root directly. https://docs.astro.build/en/reference/configuration-reference/#envdir
const workspaceDirectory = fileURLToPath(new URL("../../", import.meta.url))

export default defineConfig({
  site: siteMetadata.origin,
  integrations: [sitemap()],
  vite: {
    envDir: workspaceDirectory,
  },
})
