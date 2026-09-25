import { createFileRoute } from "@tanstack/react-router"
import { getRequestIP } from "@tanstack/react-start/server"

import { getAuth } from "@/lib/auth.server"
import { setupGateResponse } from "@/lib/config/state.server"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { isLoopbackProxyAddress } from "@/lib/utils.server"

/**
 * Better Auth reads its rate-limit and session address from `x-forwarded-for` and cannot tell who
 * sent it, so an untrusted peer's header is replaced with the peer. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/utils/ip.ts
 */
function withTrustedForwardedFor(request: Request): Request {
  const peerAddress = getRequestIP()
  if (isLoopbackProxyAddress(peerAddress)) return request
  const headers = new Headers(request.headers)
  if (peerAddress === undefined) headers.delete("x-forwarded-for")
  else headers.set("x-forwarded-for", peerAddress)
  return new Request(request, { headers })
}

async function handleAuthRequest(request: Request): Promise<Response> {
  if (getDatabaseBootstrapIssues().length > 0) {
    return new Response("Server configuration required", { status: 503 })
  }
  const gate = await setupGateResponse()
  if (gate) return gate
  return (await getAuth()).handler(withTrustedForwardedFor(request))
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
