import { defineConfig, type UserConfig } from "vite-plus"

const generatedPaths = [
  "routeTree.gen.ts",
  ".astro",
  "node_modules",
  ".tanstack",
  ".tanstack-start",
  ".nitro",
  ".output",
  ".wrangler",
  "dist",
]

// Shared app config via imports: https://viteplus.dev/guide/monorepo#composing-configuration-files
export const sharedViteConfig = {
  envDir: import.meta.dirname,
  check: {
    fmt: true,
    lint: true,
  },
  fmt: {
    semi: false, // Prevents semicolons
    ignorePatterns: ["pnpm-lock.yaml", ...generatedPaths],
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never",
        },
      },
    ],
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
      "react/react-compiler": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: generatedPaths,
  },
  resolve: { tsconfigPaths: true },
} satisfies UserConfig

export default defineConfig({
  ...sharedViteConfig,
  // run.cache is workspace-root config: https://viteplus.dev/guide/cache#workspace-config
  run: {
    cache: {
      scripts: false,
      tasks: true,
    },
  },
})
