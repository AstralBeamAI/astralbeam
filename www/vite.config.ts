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
    // The suite reads `dist`, so it has no server or prerenderer to start.
    ...(mode === "test" ? [] : [nitro({
      // Every route is prerendered, so only `dist` ships and wrangler.json stays pointed where
      // it always was. Nitro's `static` preset defines no entry and its Vite builder has no
      // case for that, so pin a server preset and leave its bundle in the ignored `.output`.
      // https://github.com/nitrojs/nitro/blob/v3/src/vite.ts
      preset: "node-server",
      output: { publicDir: "dist" },
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
