import { createFileRoute } from "@tanstack/react-router"

async function handleTenantRestRequest(request: Request): Promise<Response> {
  const { restFault, restErrorResponse, restResponseHeaders } = await import(
    "./-lib/responses.server"
  )
  if (request.method === "OPTIONS") return restResponseHeaders(new Response(null, { status: 204 }))
  try {
    const { getDatabaseBootstrapIssues } = await import("@/db/lib/database-credentials.server")
    if (getDatabaseBootstrapIssues().length) {
      throw restFault(503, "Server configuration required.", { retryAfter: 10 })
    }
    const { setupGateResponse } = await import("@/lib/config/state.server")
    if (await setupGateResponse()) {
      throw restFault(503, "Server configuration required.", { retryAfter: 10 })
    }
    const { dispatchRestRequest } = await import("./-lib/transport.server")
    return await dispatchRestRequest(request)
  } catch (error) {
    return restResponseHeaders(restErrorResponse(error, "setup"))
  }
}
export const Route = createFileRoute("/api/v1/$")({
  server: { handlers: { ANY: ({ request }) => handleTenantRestRequest(request) } },
})
