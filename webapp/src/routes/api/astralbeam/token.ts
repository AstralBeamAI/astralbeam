import { createFileRoute } from "@tanstack/react-router"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { getGlobalConfig } from "@/lib/config"
import { isSetupComplete } from "@/lib/config/state.server"
import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import { SlugSchema } from "@/lib/schemas"
import { readRequestJson, RequestTooLargeError } from "../-lib/request-body.server"

const decodeDashboardTokenRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    organizationSlug: SlugSchema,
    scope: Schema.optional(Schema.Literal("organization")),
  }),
)
const dashboardTokenHeaders = {
  "Cache-Control": "private, no-store",
  "Pragma": "no-cache",
  "Vary": "Cookie",
}

function dashboardTokenErrorResponse(error: string, status: number, code?: string) {
  return Response.json({ error, code }, { status, headers: dashboardTokenHeaders })
}

async function handleDashboardTokenRequest(request: Request): Promise<Response> {
  try {
    const baseUrl = await getGlobalConfig("app_base_url")
    if (
      !baseUrl || request.headers.get("origin") !== new URL(baseUrl).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")
    ) {
      return dashboardTokenErrorResponse("Forbidden", 403)
    }
    if (!await isSetupComplete()) {
      return dashboardTokenErrorResponse("Application is not configured", 503)
    }
    let input: ReturnType<typeof decodeDashboardTokenRequest>
    try {
      input = decodeDashboardTokenRequest(await readRequestJson(request, 1024))
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        return dashboardTokenErrorResponse("Request too large", 413)
      }
      return dashboardTokenErrorResponse("Invalid organization selector", 400)
    }
    return await runDatabaseEffect(
      issueDashboardToken({ ...input, headers: request.headers }).pipe(
        Effect.map((result) => Response.json(result, { headers: dashboardTokenHeaders })),
        Effect.catchTag("DashboardTokenError", (error) =>
          Effect.succeed(
            dashboardTokenErrorResponse(error.message, error.status, error.code),
          )),
      ),
    )
  } catch {
    return dashboardTokenErrorResponse("Authentication is unavailable", 500)
  }
}

export const Route = createFileRoute("/api/astralbeam/token")({
  server: { handlers: { POST: ({ request }) => handleDashboardTokenRequest(request) } },
})
