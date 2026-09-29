import process from "node:process"

// Nitro's own bundles have no `import.meta.env`, so fall back to NODE_ENV, failing closed.
export const IS_DEVELOPMENT_SERVER =
  (import.meta.env as ImportMetaEnv | undefined)?.DEV ?? process.env.NODE_ENV === "development"

/** A Vitest or `NODE_ENV=test` run, which must not call external breach-lookup services. */
export const IS_TEST_RUNTIME = process.env.VITEST === "true" || process.env.NODE_ENV === "test"
