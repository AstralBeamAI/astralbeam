import { setupGateResponse } from "@/lib/config/state.server"
import { dispatchRestRequest } from "./transport.server"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { restFault, restErrorResponse, restResponseHeaders } from "./responses.server"

export async function handleApiV1Request(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return restResponseHeaders(new Response(null, { status: 204 }))
  try {
    if (getDatabaseBootstrapIssues().length) {
      throw restFault(503, "Server configuration required.", { retryAfter: 10 })
    }
    if (await setupGateResponse()) {
      throw restFault(503, "Server configuration required.", { retryAfter: 10 })
    }
    return await dispatchRestRequest(request)
  } catch (error) {
    return restResponseHeaders(restErrorResponse(error, "setup"))
  }
}
