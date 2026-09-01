import { defineConfig } from "tsdown"

// Two ordered passes handle React in opposite ways: pass 1 bundles it into the widget chunk so
// the widget owns its copy, pass 2 leaves it external so the wrapper's hooks bind to the host's.
const reactPackages = /^react(-dom)?(\/|$)/
const selfPackage = /^@astralbeam\/sdk(\/|$)/
// Mirrors the tsconfig `@/*` path shadcn-generated components import through.
const srcAlias = { "@": new URL("src", import.meta.url).pathname }

export default defineConfig([
  {
    // Pass 1: bundles React into the lazily imported widget chunk.
    entry: { client: "src/client/index.ts" },
    platform: "neutral",
    dts: true,
    alias: srcAlias,
    deps: { alwaysBundle: [reactPackages] },
    minify: true,
    // React's published files branch on process.env.NODE_ENV, which browsers do not define.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  {
    // Pass 2: keeps React and the self-reference to pass 1's client entry external.
    entry: {
      server: "src/server/index.ts",
      react: "src/react/index.tsx",
      vue: "src/vue/index.ts",
      core: "src/core/index.ts",
    },
    platform: "neutral",
    dts: true,
    deps: { neverBundle: [reactPackages, selfPackage] },
    // Pass 1 already cleaned dist; cleaning again would delete its output.
    clean: false,
  },
])
