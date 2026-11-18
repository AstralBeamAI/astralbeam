import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { organization } from "@/db/schema/organizations"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"

/**
 * Liveness probe that stays reachable without a session and never reads, logs, or parses a
 * request. A bounded organization query checks that the database and table are available.
 */
const statusResponse = Effect.gen(function* () {
  const db = yield* Database
  yield* db.select({ id: organization.id }).from(organization).limit(1)
  return Response.json({ status: "ok" })
}).pipe(
  Effect.catchCause(() =>
    Effect.succeed(Response.json({ error: "Database query failed" }, { status: 503 })),
  ),
)

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: () => runRouteEffect(statusResponse),
    },
  },
})
