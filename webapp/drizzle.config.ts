import { defineConfig } from "drizzle-kit"
import { loadEnv } from "vite"

const databaseUrl = loadEnv("development", new URL(".", import.meta.url).pathname, "").DATABASE_URL

if (!databaseUrl) throw new Error("DATABASE_URL is required")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.server.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
})
