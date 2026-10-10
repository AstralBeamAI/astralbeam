import { Effect } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { Config } from "@/lib/config/config"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"

/** The deployment's public origin, for the absolute URLs crawlers require. */
export function resolveAppOrigin(request: Request): Promise<string> {
  // A crawler reads robots.txt before setup stores a base URL and while the database holding it is
  // unreachable, and treats a 5xx there as disallow-all, so the request's origin is the fallback.
  const requestOrigin = new URL(request.url).origin
  if (getDatabaseBootstrapIssues().length > 0) return Promise.resolve(requestOrigin)
  return runRouteEffect(
    Effect.flatMap(Config, (config) => config.get("app_base_url")).pipe(
      Effect.catchCause(() => Effect.succeed(undefined)),
      Effect.map((appBaseUrl) => appBaseUrl ?? requestOrigin),
    ),
  )
}
