import { fileURLToPath } from "node:url"
import { defineConfig } from "drizzle-kit"
import { loadEnv } from "vite"

// Drizzle Kit does not load Vite modes; fall back to local development defaults only. https://vite.dev/config/#using-environment-variables-in-config
const envDir = fileURLToPath(new URL("../..", import.meta.url))
const databaseUrl =
  process.env.DATABASE_URL ?? loadEnv("development", envDir, "DATABASE_URL").DATABASE_URL

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
