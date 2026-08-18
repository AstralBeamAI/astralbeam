import { DATABASE_URL } from "#/lib/config.server"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/schema.server.ts",
  out: "./migrations",
  dbCredentials: {
    url: DATABASE_URL,
  },
})
