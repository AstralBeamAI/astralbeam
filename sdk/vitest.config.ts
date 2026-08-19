import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      // Resolve the react entry's package self-reference to source so tests run without a build.
      "@astralbeam/sdk/client": fileURLToPath(new URL("src/client.ts", import.meta.url)),
    },
  },
})
