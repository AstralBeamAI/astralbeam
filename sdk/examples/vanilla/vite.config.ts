import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    alias: {
      // Compile the SDK straight from source so the example exercises local changes without a
      // separate build or publish step. React comes from this example's devDependencies.
      "@astralbeam/sdk/client": fileURLToPath(new URL("../../src/client.ts", import.meta.url)),
    },
  },
})
