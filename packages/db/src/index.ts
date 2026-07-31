import "@tanstack/react-start/server-only"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

const client = postgres(databaseUrl)

export const db = drizzle({ client })
