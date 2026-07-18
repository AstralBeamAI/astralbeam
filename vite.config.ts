import { defineConfig } from "vite-plus"

const generatedPaths = [
  "routeTree.gen.ts",
  "node_modules",
  ".tanstack",
  ".tanstack-start",
  ".nitro",
  ".output",
  ".wrangler",
  "dist",
]

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
    plugins: ["typescript", "react", "jsx-a11y"],
    env: {
      builtin: true,
      browser: true,
      node: true,
    },
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
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
})
