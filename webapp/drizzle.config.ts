import { defineConfig } from "drizzle-kit"
import { loadEnv } from "vite";

const env = loadEnv("development", new URL(".", import.meta.url).pathname, "");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/schema.server.ts",
  out: "./migrations",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
