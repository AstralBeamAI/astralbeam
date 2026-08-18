import { fileURLToPath } from "node:url"

import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite-plus"

const workspaceDirectory = fileURLToPath(new URL("./", import.meta.url))

function loadWorkspaceEnvironment(mode: string) {
  for (const [name, value] of Object.entries(loadEnv(mode, workspaceDirectory, ""))) {
    process.env[name] ??= value
  }
}

function workspaceEnvironmentPlugin(): Plugin {
  return {
    name: "astralbeam:workspace-environment",
    enforce: "pre",
    config(_config, { mode }) {
      // Load before Vite creates its module runners so server packages inherit the root environment. https://vite.dev/guide/api-plugin.html#config
      loadWorkspaceEnvironment(mode)
    },
  }
}

const workspaceEnvironmentViteConfig = {
  envDir: workspaceDirectory,
  plugins: [workspaceEnvironmentPlugin()],
} satisfies UserConfig

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
  ...workspaceEnvironmentViteConfig,
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
      // Keep the stable Rules of Hooks check explicit even though compiler lint also reports hook-order violations. https://react.dev/reference/eslint-plugin-react-hooks
      "react/rules-of-hooks": "error",
      // React Compiler lint is experimental and intentionally absent from category presets.
      "react/react-compiler": "error",
      // Compiler enforcement lives in react/react-compiler and the webapp's compiler preset; disable legacy allocation rules that encourage redundant manual memoization. https://react.dev/reference/react-compiler/introduction#what-does-react-compiler-do
      "react-perf/jsx-no-jsx-as-prop": "off",
      "react-perf/jsx-no-new-array-as-prop": "off",
      "react-perf/jsx-no-new-function-as-prop": "off",
      "react-perf/jsx-no-new-object-as-prop": "off",
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
