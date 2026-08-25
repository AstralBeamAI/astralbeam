import { readdirSync, readFileSync } from "node:fs"
import process from "node:process"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, loadEnv } from "vite"

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

const config = defineConfig(({ mode }) => {
  // Expand mode files through Vite before server modules read process.env; existing shell and
  // deployment variables still win. https://vite.dev/config/#using-environment-variables-in-config
  const runtimeEnvironment = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "")
  for (const [key, value] of Object.entries(runtimeEnvironment)) {
    process.env[key] ??= value
  }

  return {
    resolve: { tsconfigPaths: true },
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
    plugins: [
      {
        name: "legal-assets",
        apply: "build",
        generateBundle() {
          for (const asset of legalAssets) this.emitFile({ type: "asset", ...asset })
        },
      },
      devtools(),
      ...(mode === "test" ? [] : nitro()),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})

export default config
