import { readdirSync, readFileSync } from "node:fs"
import { extname } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, type DevEnvironment } from "vite"
import { configDefaults } from "vitest/config"

import { collectSourceMaps, sourceMapDebugIds } from "./source-maps.ts"

const licensesDirectory = new URL("../docs/legal/LICENSES/", import.meta.url)
const legalAssets = [
  {
    fileName: "LICENSE-AGPL",
    source: readFileSync(new URL("../LICENSE-AGPL", import.meta.url), "utf8"),
  },
  {
    fileName: "THIRD_PARTY_NOTICES.md",
    source: readFileSync(new URL("../docs/legal/THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
  },
  ...readdirSync(licensesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted()
    .map((fileName) => ({
      fileName: `LICENSES/${fileName}`,
      source: readFileSync(new URL(fileName, licensesDirectory), "utf8"),
    })),
]

const viteConfig = defineConfig(({ mode }) => {
  return {
    resolve: { tsconfigPaths: true },
    // `strictPort` keeps a busy port an error instead of a silent move to the next one, which
    // would leave APP_BASE_URL, auth cookies, and email links pointing at another server.
    server: {
      port: Number(process.env.PORT ?? 4500),
      strictPort: true,
    },
    // @tanstack/ai-sandbox-docker uses dockerode, whose optional SSH transport includes a native module that Vite cannot prebundle. https://github.com/apocas/dockerode#connecting-to-docker
    optimizeDeps: {
      exclude: ["dockerode"],
      // Prebundle lazy client imports to avoid a reload during initial hydration.
      // https://vite.dev/config/dep-optimization-options.html#optimizedeps-include
      include: ["jose/errors", "seroval"],
    },
    build: {
      target: "es2025",
      // Generate exact client and server dependency license reports from each bundle graph.
      // https://vite.dev/config/build-options.html#build-license
      license: { fileName: "THIRD_PARTY_LICENSES.md" },
      rolldownOptions: {
        // Skip compiling unused re-exports of side-effect-free barrels such as @phosphor-icons/react.
        // https://rolldown.rs/in-depth/lazy-barrel-optimization
        experimental: { lazyBarrel: true },
        output: {
          postBanner:
            "/*! See LICENSE-AGPL, THIRD_PARTY_LICENSES.md, and THIRD_PARTY_NOTICES.md in this distribution. */",
        },
      },
    },
    // Server bundles gain nothing from code splitting. Their dynamic imports break import cycles or
    // keep the OpenAPI export's graph database-free, so only the client keeps this check.
    environments: {
      ssr: { build: { rolldownOptions: { checks: { ineffectiveDynamicImport: false } } } },
    },
    plugins: [
      {
        ...sourceMapDebugIds,
        applyToEnvironment: (environment) => environment.name !== "ssr",
      },
      {
        name: "legal-assets",
        apply: "build",
        generateBundle() {
          for (const asset of legalAssets) this.emitFile({ type: "asset", ...asset })
        },
      },
      {
        name: "cluster-development-close",
        apply: "serve",
        configureServer(server) {
          // Nitro environments share one runner. Use its graceful shutdown before any closes it.
          // https://github.com/unjs/env-runner#runners
          const environment = server.environments.nitro as
            | (DevEnvironment & {
                devServer: { close(): Promise<void>; shutdown(timeout: number): Promise<void> }
              })
            | undefined
          if (!environment) return
          let closing: Promise<void> | undefined
          environment.devServer.close = () => (closing ??= environment.devServer.shutdown(10_000))
          // Vite removes its one-shot signal handler before cleanup. Keep repeated signals harmless.
          const retainSignals = () => undefined
          const close = server.close.bind(server)
          let closingServer: Promise<void> | undefined
          server.close = (...args) =>
            (closingServer ??= (async () => {
              process.on("SIGINT", retainSignals)
              process.on("SIGTERM", retainSignals)
              try {
                await close(...args)
              } finally {
                process.off("SIGINT", retainSignals)
                process.off("SIGTERM", retainSignals)
              }
            })())
        },
      },
      devtools(),
      ...(mode === "test"
        ? []
        : nitro({
            preset: "bun",
            compressPublicAssets: true,
            sourcemap: true,
            experimental: { sourcemapMinify: false },
            // Trace Daytona's dynamic busboy import and every installed native Sharp package.
            // https://nitro.build/config#tracedeps
            traceDeps: ["busboy", "@img", "@img/sharp-win32-x64*"],
            minify: true,
            // Nitro bundles runtime plugins itself, so it needs the tsconfig `@/` path mapping too.
            // https://nitro.build/config#alias
            alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
            // Like SSR, skip the dynamic-import check, and the "use client" directives Vite already hides,
            // which only React Server Components use. https://rolldown.rs/in-depth/directives
            rolldownConfig: {
              checks: { moduleLevelDirective: false, ineffectiveDynamicImport: false },
            },
            // Nitro prerenders before indexing static assets, including their content-based ETags.
            // https://nitro.build/docs/prerender
            prerender: {
              routes: ["/docs"],
              crawlLinks: true,
              ignore: [(path) => path !== "/docs" && !path.startsWith("/docs/")],
              failOnError: true,
            },
            hooks: {
              "vite:compile:before": (nitro) => {
                collectSourceMaps(nitro.options.output.publicDir)
              },
              compiled: (nitro) => {
                collectSourceMaps(nitro.options.output.serverDir)
              },
              // A bare /docs/<section> URL redirects to the section's first page, and Nitro writes an
              // extensionless response body over the directory holding that section's own pages.
              "prerender:generate": (route) => {
                if (!extname(route.fileName ?? "")) route.skip = true
              },
              "prerender:config": (config) => {
                // Shared route imports create lazy pools. Only the prerender bundle gets this URL.
                // https://nitro.build/config#hooks
                config.replace = {
                  ...config.replace,
                  "process.env.DATABASE_URL": JSON.stringify("postgres://127.0.0.1:1/prerender"),
                }
              },
            },
            plugins: [
              "./src/lib/runtime/response-headers.server.ts",
              "./src/lib/runtime/nitro-logging-plugin.server.ts",
              "./src/lib/cluster/plugin.ts",
            ],
          })),
      tailwindcss(),
      tanstackStart({
        server: { build: { inlineCss: true } },
        router: {
          codeSplittingOptions: {
            // Keep dashboard loading UI out of public documentation's initial bundle.
            // https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting
            defaultBehavior: [
              ["component"],
              ["pendingComponent"],
              ["errorComponent"],
              ["notFoundComponent"],
            ],
          },
        },
        importProtection: {
          client: {
            files: [
              "**/*.server.*",
              "**/src/db/**",
              "**/src/emails/**",
              "**/src/lib/chat/**",
              "**/src/lib/cluster/**",
              "**/src/lib/config/**",
              "**/src/lib/email/providers/**",
              "**/src/lib/tenants/**",
              "**/src/lib/workflows/**",
            ],
          },
        },
      }),
      viteReact(),
    ],
    test: {
      // Keep an explicitly selected disposable database, while allowing imports without one.
      env: {
        OTEL_SDK_DISABLED: "true",
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test",
      },
      // `e2e` holds Playwright specs, which `bun run e2e` runs in its own runner.
      exclude: [...configDefaults.exclude, "e2e/**"],
      // Integration suites share one disposable database, so run their files one at a time.
      // https://vitest.dev/guide/projects
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            exclude: [...configDefaults.exclude, "e2e/**", "**/*.integration.test.*"],
          },
        },
        {
          extends: true,
          test: {
            name: "integration",
            include: ["**/*.integration.test.*"],
            fileParallelism: false,
            sequence: { groupOrder: 1 },
          },
        },
      ],
    },
  }
})

export default viteConfig
