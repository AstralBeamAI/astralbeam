import { readdirSync, readFileSync } from "node:fs"

import tailwindcss from "@tailwindcss/vite"
import babel from "@rolldown/plugin-babel"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, lazyPlugins, mergeConfig } from "vite-plus"
import { sharedViteConfig } from "../../vite.config"

const licensesDirectory = new URL("../../docs/legal/LICENSES/", import.meta.url)
const legalAssets = [
  {
    fileName: "LICENSE-AGPL",
    source: readFileSync(new URL("../../LICENSE-AGPL", import.meta.url), "utf8"),
  },
  {
    fileName: "THIRD_PARTY_NOTICES.md",
    source: readFileSync(
      new URL("../../docs/legal/THIRD_PARTY_NOTICES.md", import.meta.url),
      "utf8",
    ),
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

export default defineConfig(({ mode }) =>
  mergeConfig(sharedViteConfig, {
    server: { port: 3000 },
    build: {
      // Generate exact client and server dependency license reports from each bundle graph.
      // https://vite.dev/config/build-options.html#build-license
      license: { fileName: "THIRD_PARTY_LICENSES.md" },
      rolldownOptions: {
        output: {
          postBanner:
            "/*! See LICENSE-AGPL, THIRD_PARTY_LICENSES.md, and THIRD_PARTY_NOTICES.md in this distribution. */",
        },
      },
    },
    plugins: lazyPlugins(() => [
      {
        name: "astralbeam-legal-assets",
        apply: "build",
        generateBundle() {
          for (const asset of legalAssets) this.emitFile({ type: "asset", ...asset })
        },
      },
      devtools(),
      tanstackStart(),
      // Vitest reads this config in `test` mode; starting Nitro there fails before discovery.
      // https://vitest.dev/guide/#configuring-vitest
      ...(mode === "test" ? [] : [nitro()]),
      viteReact(),
      // Fail on critical compiler errors during development, but skip unsupported components in every deployable or automated mode.
      // https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#react-compiler
      // https://react.dev/reference/react-compiler/panicThreshold
      babel({
        presets: [
          reactCompilerPreset({
            panicThreshold: mode === "development" ? "critical_errors" : "none",
          }),
        ],
      }),
      tailwindcss(),
    ]),
  }),
)
