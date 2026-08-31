import { drizzle } from "drizzle-orm/node-postgres"

import { getDatabaseUrl } from "@/db/lib/database-credentials.server"
import { databaseRelations } from "@/db/schema.server"

export const db = drizzle({
  connection: {
    // Keep process lifetime under the server runtime's control, not idle database sockets.
    // https://node-postgres.com/apis/pool
    allowExitOnIdle: true,
    connectionString: getDatabaseUrl(),
  },
  jit: true,
  relations: databaseRelations,
})

db.$client.on("error", (error) => {
  const code = "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN"
  console.error("Database pool idle client error", { code })
})
