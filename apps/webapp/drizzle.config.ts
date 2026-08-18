import { defineConfig } from "drizzle-kit"

import { loadWorkspaceEnvironment } from "./config/workspace-environment.ts"

// Drizzle Kit does not load Vite modes; fall back to local development defaults only. https://vite.dev/config/#using-environment-variables-in-config
loadWorkspaceEnvironment("development")
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl,
  },
})
