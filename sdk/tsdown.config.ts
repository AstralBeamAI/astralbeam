import { defineConfig } from "tsdown"

// React is listed in both peerDependencies and devDependencies, and its handling differs per
// build pass: the client entry bundles React into its lazily imported widget chunk so the widget
// always runs its own React copy (host pages may not ship React, or may ship a different
// version), while the react entry must keep React external so the wrapper component resolves
// hooks from the host app's React instance
// (https://react.dev/warnings/invalid-hook-call-warning). The react entry reaches the widget by
// self-referencing @astralbeam/sdk/client, which must also stay external so both entries share
// the client pass's single widget chunk.
const reactPackages = /^react(-dom)?(\/|$)/
const selfPackage = /^@astralbeam\/sdk(\/|$)/

export default defineConfig([
  {
    entry: { client: "src/client.ts" },
    // The client, react, and vue entries run in browsers, so avoid Node-only output assumptions.
    platform: "neutral",
    dts: true,
    deps: { alwaysBundle: [reactPackages] },
    minify: true,
    // React's published files branch on process.env.NODE_ENV, which browsers do not define.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  },
  {
    entry: {
      server: "src/server.ts",
      react: "src/react.tsx",
      vue: "src/vue.ts",
    },
    platform: "neutral",
    dts: true,
    deps: { neverBundle: [reactPackages, selfPackage] },
    // The first build pass already cleaned dist; cleaning again would delete its output.
    clean: false,
  },
])
