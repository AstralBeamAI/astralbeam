import { defineConfig, lazyPlugins } from "vite-plus"
import { devtools } from "@tanstack/devtools-vite"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"

import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

const generatedPaths = ["routeTree.gen.ts", "pnpm-lock.yaml"]

export default defineConfig({
  check: {
    fmt: true,
    lint: true,
  },
  fmt: {
    semi: false, // Prevents semicolons
    ignorePatterns: ["pnpm-lock.yaml", ...generatedPaths],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: generatedPaths,
  },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [devtools(), nitro(), tailwindcss(), tanstackStart(), viteReact()]),
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
})
