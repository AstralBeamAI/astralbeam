import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The suite asserts against the production build output rather than importing Astro components.
    include: ["scripts/**/*.test.ts"],
  },
})
