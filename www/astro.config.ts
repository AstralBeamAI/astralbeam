import { fileURLToPath } from "node:url"

import sitemap from "@astrojs/sitemap"
import { defineConfig } from "astro/config"

import { siteMetadata } from "./src/lib/site.ts"

const workspaceDirectory = fileURLToPath(new URL("../", import.meta.url))

export default defineConfig({
  site: siteMetadata.origin,
  integrations: [sitemap()],
  vite: {
    // Astro's Vite root is this directory, so point environment loading and dev-server file access at the repository root for the shared env files and license text imports. https://docs.astro.build/en/reference/configuration-reference/#envdir
    envDir: workspaceDirectory,
    server: { fs: { allow: [workspaceDirectory] } },
  },
})
