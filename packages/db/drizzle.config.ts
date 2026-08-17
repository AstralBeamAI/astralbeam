import { loadWorkspaceEnvironment } from "@astralbeam/utils/environment"
import { defineConfig } from "drizzle-kit"

// Drizzle Kit does not load Vite modes; fall back to local development defaults only. https://vite.dev/config/#using-environment-variables-in-config
loadWorkspaceEnvironment("development")
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl,
  },
})
