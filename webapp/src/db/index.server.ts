import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { databaseRelations } from "@/db/schema.server"
import { getDatabaseUrl } from "@/db/lib/database-credentials.server"

const client = postgres(getDatabaseUrl())

export const db = drizzle({ client, relations: databaseRelations })
