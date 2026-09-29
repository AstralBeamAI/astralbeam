import process from "node:process"

// Nitro's own bundles have no `import.meta.env`, so fall back to NODE_ENV, failing closed.
export const IS_DEVELOPMENT_SERVER =
  (import.meta.env as ImportMetaEnv | undefined)?.DEV ?? process.env.NODE_ENV === "development"
