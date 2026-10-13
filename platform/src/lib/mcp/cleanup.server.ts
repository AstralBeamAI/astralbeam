import { lte, sql } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@/db/database"
import { mcpOAuthAttempt, tenantMcpOAuthAttempt } from "@/db/schema/mcp"

export const cleanupMcpAttempts = Effect.gen(function* () {
  const db = yield* Database
  for (const table of [mcpOAuthAttempt, tenantMcpOAuthAttempt])
    yield* db
      .delete(table)
      .where(lte(table.expiresAt, sql`now()`))
      .pipe(Effect.orDie)
})
