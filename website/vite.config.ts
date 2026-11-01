import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import frontMatter from "front-matter"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

import { collectSourceMaps, sourceMapDebugIds } from "../platform/source-maps.ts"
import { siteUrl } from "./src/lib/site.ts"

const workspaceDirectory = join(import.meta.dirname, "..")

// Discover Markdown filenames so new posts are published without a second route list.
const blogRoutes = readdirSync(new URL("./src/content/blog/", import.meta.url))
  .filter((name) => name.endsWith(".md"))
  .map((name) => `/blog/${name.slice(0, -3)}`)

const prerenderRoutes = [
  "/",
  "/home",
  "/terms",
  "/privacy",
  "/blog",
  "/blog/feed.xml",
  ...blogRoutes,
  "/404",
  "/favicon.png",
  "/og-image.png",
  "/licenses.txt",
  "/llms.txt",
  "/robots.txt",
  "/site.webmanifest",
  "/sitemap.xml",
]

export default defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  // The licenses route imports repository-level files. https://vite.dev/config/server-options.html#server-fs-allow
  server: { host: true, port: 4600, strictPort: true, fs: { allow: [workspaceDirectory] } },
  preview: { port: 4620 },
  // The platform proxies this prefix when it serves the website under its own origin.
  build: {
    target: "es2025",
    assetsDir: "website-assets",
    // Let unicode ranges select fonts instead of embedding unused subsets in blocking CSS.
    // https://vite.dev/config/build-options#build-assetsinlinelimit
    assetsInlineLimit: (filePath) => (/\.woff2?$/u.test(filePath) ? false : undefined),
  },
  plugins: [
    {
      ...sourceMapDebugIds,
      applyToEnvironment: (environment) => environment.name === "client",
    },
    // The suite reads the built output, so it has no server or prerenderer to start.
    mode !== "test" &&
      nitro({
        // Only public output ships. Nitro's static preset has no Vite entry, so use Bun.
        // https://github.com/nitrojs/nitro/blob/v3/src/vite.ts
        preset: "bun",
        publicAssets: [
          { dir: "../skills", baseURL: "/agent-skills" },
          { dir: "src/content/blog", baseURL: "/blog", fallthrough: true },
        ],
        prerender: {
          routes: prerenderRoutes,
          crawlLinks: false,
          // Cloudflare's `404-page` handling serves `/404.html`, and subfolder indexes would
          // write `404/index.html`. https://nitro.build/config#prerender
          autoSubfolderIndex: false,
          failOnError: true,
        },
        hooks: {
          "vite:compile:before": (nitro) => {
            collectSourceMaps(nitro.options.output.publicDir)
          },
          compiled(nitro) {
            const output = nitro.options.output.publicDir
            const skill = readFileSync(join(workspaceDirectory, "skills/astralbeam/SKILL.md"))
            const { attributes } = frontMatter<{ name: string; description: string }>(
              skill.toString(),
            )
            const index = {
              $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
              skills: [
                {
                  name: attributes.name,
                  description: attributes.description,
                  type: "skill-md",
                  url: siteUrl("/agent-skills/astralbeam/SKILL.md"),
                  digest: `sha256:${createHash("sha256").update(skill).digest("hex")}`,
                },
              ],
            }
            const indexDirectory = join(output, ".well-known/agent-skills")
            mkdirSync(indexDirectory, { recursive: true })
            writeFileSync(join(indexDirectory, "index.json"), JSON.stringify(index))
            const headers = readFileSync(new URL("./public/_headers", import.meta.url), "utf8")
            // Cloudflare redirects HTML filenames to these canonical URLs; /404 has a static rule.
            // https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
            const htmlHeaders = prerenderRoutes
              .filter((path) => !extname(path) && path !== "/404")
              .map((path) => `${path}\n  Cache-Control: public, no-cache\n`)
            const sourceHeaders = blogRoutes.map(
              (path) =>
                `${path}.md\n  Content-Type: text/plain; charset=utf-8\n  Content-Disposition: inline\n  Cache-Control: no-cache\n`,
            )
            writeFileSync(
              join(output, "_headers"),
              `${headers}\n${htmlHeaders.concat(sourceHeaders).join("\n")}`,
            )
          },
        },
      }),
    tanstackStart(),
    viteReact(),
  ],
}))
