import { defineConfig } from "vitest/config"

// Standalone, not the app's `vite.config.ts`: Nitro has no role in a unit run, and `include` has to
// exclude `e2e`, whose Playwright specs Vitest would otherwise collect. https://vitest.dev/config/#include
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["src/**/*.test.ts"] },
})
