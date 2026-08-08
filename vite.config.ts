import { defineConfig, type UserConfig } from "vite-plus"

const generatedPaths = [
  ".agents/skills",
  ".claude/skills",
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

  // Use Oxlint's native categories and plugins instead of a third-party shared configuration.
  // https://oxc.rs/docs/guide/usage/linter/config.html#enable-groups-of-rules-with-categories
  lint: {
    plugins: [
      "eslint",
      "typescript",
      "unicorn",
      "react",
      "react-perf",
      "oxc",
      "import",
      "jsx-a11y",
      "promise",
      "vitest",
    ],
    env: {
      builtin: true,
      browser: true,
      node: true,
    },
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      // Stylesheets, Fontsource fonts (CSS entry points), and TanStack's server-only guard are intentionally loaded for side effects.
      "import/no-unassigned-import": [
        "error",
        {
          allow: [
            "**/*.css",
            "@fontsource/**",
            "@fontsource-variable/**",
            "@tanstack/react-start/server-only",
          ],
        },
      ],
      // The automatic JSX runtime does not require React to be imported in every TSX file.
      "react/react-in-jsx-scope": "off",
      // React Compiler lint is experimental and intentionally absent from category presets.
      "react/react-compiler": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: generatedPaths,
    overrides: [
      {
        files: ["apps/www/src/**/*.astro"],
        env: { astro: true },
      },
    ],
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
