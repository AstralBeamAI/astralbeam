import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { databaseRelations } from "@/db/schema.server"
import { DATABASE_URL } from "@/lib/config.server"

const client = postgres(DATABASE_URL)

export const db = drizzle({ client, relations: databaseRelations })
