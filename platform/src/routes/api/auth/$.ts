import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"

const handleAuthRequest = Effect.fn("handleAuthRequest")(
  function* () {
    const { setupComplete } = yield* Effect.flatMap(Config, (config) => config.setupState)
    if (!setupComplete) {
      return Response.json(
        { error: "Application is not configured" },
        { status: 503, headers: { "retry-after": "10" } },
      )
    }
    const { request, clientAddress } = yield* ServerRequest
    const auth = yield* Auth
    return yield* auth.handler(request, clientAddress)
  },
  // Better Auth answers its own errors, so only an unexpected failure reaches this.
  Effect.catchCause((cause) =>
    Effect.map(
      reportFailure("handleAuthRequest", cause),
      () => new Response("Authentication is unavailable", { status: 500 }),
    ),
  ),
)

function serveAuthRequest(): Response | Promise<Response> {
  // Without these variables no Effect can run.
  if (getDatabaseBootstrapIssues().length > 0) {
    return new Response("Server configuration required", { status: 503 })
  }
  return runRouteEffect(handleAuthRequest())
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: serveAuthRequest,
      POST: serveAuthRequest,
    },
  },
})
