import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { serverEnvironment } from "@/server/env.server"

import { authRelations, organizationAccessRelations } from "./schema.server"

export interface DatabaseOptions {
  url: string
}

function createDatabase({ url }: DatabaseOptions) {
  const client = postgres(url)
  return drizzle({
    client,
    relations: { ...authRelations, ...organizationAccessRelations },
  })
}

export const database = createDatabase({ url: serverEnvironment.DATABASE_URL })

export type Database = typeof database
