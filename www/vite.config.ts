import { fileURLToPath } from "node:url"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

const workspaceDirectory = fileURLToPath(new URL("../", import.meta.url))

// Every route the build must emit. The website has no dynamic routes, so nothing is crawled.
const prerenderRoutes = [
  "/",
  "/terms",
  "/privacy",
  "/404",
  "/favicon.png",
  "/og-image.png",
  "/licenses.txt",
  "/llms.txt",
  "/robots.txt",
  "/schemas/theme.schema.json",
  "/site.webmanifest",
  "/sitemap.xml",
]

export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  // The licenses route imports repository-level files. https://vite.dev/config/server-options.html#server-fs-allow
  server: { host: true, port: 4600, strictPort: true, fs: { allow: [workspaceDirectory] } },
  preview: { host: true, port: 4001, strictPort: true },
  build: { target: "es2025" },
  plugins: [
    // The suite reads the built output, so it has no server or prerenderer to start.
    ...(mode === "test" ? [] : [nitro({
      // Every route is prerendered, so only `.output/public` ships and the server bundle beside
      // it goes unused. Nitro's `static` preset defines no entry and its Vite builder has no
      // case for that, so pin a server preset instead.
      // The output paths stay at their defaults: Nitro registers its public output directory as
      // a top-level fallthrough asset root, and reading from it throws in dev, so pointing it
      // inside the project breaks `dev` for every path that the last build wrote a file for.
      // https://github.com/nitrojs/nitro/blob/v3/src/vite.ts
      preset: "node-server",
      prerender: {
        routes: prerenderRoutes,
        crawlLinks: false,
        // Cloudflare's `404-page` handling serves `/404.html`, and subfolder indexes would
        // write `404/index.html`. https://nitro.build/config#prerender
        autoSubfolderIndex: false,
        failOnError: true,
      },
    })]),
    tanstackStart(),
    viteReact(),
  ],
}))
