import process from "node:process"

import { defineConfig } from "drizzle-kit"
import { loadEnv } from "vite"

export const databaseUrl =
  process.env.DATABASE_URL ??
  loadEnv("development", new URL(".", import.meta.url).pathname, "").DATABASE_URL

if (!databaseUrl) throw new Error("DATABASE_URL is required")

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.server.ts",
  out: "./src/db/migrations",
  schemaFilter: ["public"],
  // Effect initializes and migrates its own tables. Exclude them from Drizzle pull introspection.
  // https://effect.website/docs/v4/api/effect/unstable/cluster/SqlMessageStorage/
  tablesFilter: ["!effect_*"],
  dbCredentials: {
    url: databaseUrl,
  },
})
