import "@tanstack/react-start/server-only"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { authRelations, relations } from "./schema"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

const client = postgres(databaseUrl)

export const db = drizzle({
  client,
  // Relation parts must follow the full relation definition. https://orm.drizzle.team/docs/relations-v2#relations-parts
  relations: { ...relations, ...authRelations },
})
