import { createFileRoute } from "@tanstack/react-router"
import { count } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase, runDatabaseEffect } from "@/db"
import { organization } from "@/db/schema/organizations.server"

/**
 * Liveness probe that stays reachable without a session and never reads, logs, or parses a
 * request. It counts organization rows only to confirm the database answers.
 */
async function handleStatusRequest() {
  try {
    await runDatabaseEffect(
      Effect.gen(function* () {
        const db = yield* effectDatabase
        yield* db.select({ value: count() }).from(organization).pipe(Effect.orDie)
      }),
    )
    return Response.json({ status: "ok" })
  } catch {
    return Response.json({ error: "Database query failed" }, { status: 503 })
  }
}

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: handleStatusRequest,
    },
  },
})
