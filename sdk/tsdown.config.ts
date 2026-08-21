import { defineConfig } from "tsdown"

// Two ordered passes handle React in opposite ways; see ARCHITECTURE.md for the rationale.
const reactPackages = /^react(-dom)?(\/|$)/
const selfPackage = /^@astralbeam\/sdk(\/|$)/

export default defineConfig([
  {
    // Pass 1: bundles React into the lazily imported widget chunk.
    entry: { client: "src/client.ts" },
    platform: "neutral",
    dts: true,
    deps: { alwaysBundle: [reactPackages] },
    minify: true,
    // React's published files branch on process.env.NODE_ENV, which browsers do not define.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  {
    // Pass 2: keeps React and the self-reference to pass 1's client entry external.
    entry: {
      server: "src/server.ts",
      react: "src/react.tsx",
      vue: "src/vue.ts",
    },
    platform: "neutral",
    dts: true,
    deps: { neverBundle: [reactPackages, selfPackage] },
    // Pass 1 already cleaned dist; cleaning again would delete its output.
    clean: false,
  },
])
