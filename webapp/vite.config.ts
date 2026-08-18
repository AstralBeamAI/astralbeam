import { readdirSync, readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const licensesDirectory = new URL('../docs/legal/LICENSES/', import.meta.url)
const legalAssets = [
  {
    fileName: 'LICENSE-AGPL',
    source: readFileSync(new URL('../LICENSE-AGPL', import.meta.url), 'utf8'),
  },
  {
    fileName: 'THIRD_PARTY_NOTICES.md',
    source: readFileSync(
      new URL('../docs/legal/THIRD_PARTY_NOTICES.md', import.meta.url),
      'utf8',
    ),
  },
  ...readdirSync(licensesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => ({
      fileName: `LICENSES/${fileName}`,
      source: readFileSync(new URL(fileName, licensesDirectory), 'utf8'),
    })),
]

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    // Generate exact client and server dependency license reports from the bundle graph.
    // https://vite.dev/config/build-options.html#build-license
    license: { fileName: 'THIRD_PARTY_LICENSES.md' },
    rollupOptions: {
      output: {
        banner:
          '/*! See LICENSE-AGPL, THIRD_PARTY_LICENSES.md, and THIRD_PARTY_NOTICES.md in this distribution. */',
      },
    },
  },
  plugins: [
    {
      name: 'webapp2-legal-assets',
      apply: 'build',
      generateBundle() {
        for (const asset of legalAssets) this.emitFile({ type: 'asset', ...asset })
      },
    },
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
