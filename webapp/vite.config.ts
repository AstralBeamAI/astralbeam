import { readdirSync, readFileSync } from "node:fs"

import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

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
    build: {
      target: "es2025",
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
      devtools({
        // Prevent source-inspection attributes in email HTML. https://tanstack.com/devtools/latest/docs/source-inspector#ignoring-files-and-components
        injectSource: { enabled: true, ignore: { files: [/\/src\/emails\//] } },
      }),
      ...(mode === "test" ? [] : nitro()),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
    test: {
      // Vitest workers do not inherit the .env.development values that nitro loads, and every test
      // mocks the database, so a parseable placeholder is all module-level clients need.
      env: { DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test" },
    },
  }
})

export default viteConfig
