import { createFileRoute } from "@tanstack/react-router"
import { Effect } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { isLoopbackProxyAddress } from "@/lib/utils.server"

/**
 * Better Auth reads its rate-limit and session address from `x-forwarded-for` and cannot tell who
 * sent it, so an untrusted peer's header is replaced with the peer. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/utils/ip.ts
 */
function withTrustedForwardedFor(request: Request, peerAddress: string | undefined): Request {
  if (isLoopbackProxyAddress(peerAddress)) return request
  const headers = new Headers(request.headers)
  if (peerAddress === undefined) headers.delete("x-forwarded-for")
  else headers.set("x-forwarded-for", peerAddress)
  return new Request(request, { headers })
}

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
    return yield* auth.handler(withTrustedForwardedFor(request, clientAddress))
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
