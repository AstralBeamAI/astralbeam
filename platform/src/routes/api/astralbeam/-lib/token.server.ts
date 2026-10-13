import { Effect, Result, Schema, SchemaIssue } from "effect"

import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import { Config } from "@/lib/config/config"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { declaredHttpApiStatus } from "@/lib/runtime/http-api-status"
import { SlugSchema } from "@/lib/organizations/slug"
import { validationParseOptions } from "@/lib/schemas"
import { readRequestJson } from "../../-lib/request-body.server"

const decodeDashboardTokenRequest = Schema.decodeUnknownResult(
  Schema.Struct({
    organizationSlug: SlugSchema,
    scope: Schema.optional(Schema.Literal("organization")),
  }),
  validationParseOptions,
)
const dashboardTokenHeaders = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Vary: "Cookie",
}
const formatDashboardTokenIssues = SchemaIssue.makeFormatterStandardSchemaV1()

export function dashboardTokenErrorResponse(error: string, status: number, code?: string) {
  return Response.json({ error, code }, { status, headers: dashboardTokenHeaders })
}

/** Issues a dashboard token for a same-origin JSON request, never caching an answer. */
export const handleDashboardTokenRequest = Effect.fn("handleDashboardTokenRequest")(
  function* (request: Request) {
    const config = yield* Config
    const baseUrl = yield* config.get("app_base_url")
    if (
      !baseUrl ||
      request.headers.get("origin") !== new URL(baseUrl).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")
    ) {
      return dashboardTokenErrorResponse("Forbidden", 403)
    }
    if (!(yield* config.setupState).setupComplete) {
      return dashboardTokenErrorResponse("Application is not configured", 503)
    }
    const body = yield* Effect.result(readRequestJson(request, 1024))
    if (Result.isFailure(body)) {
      return body.failure._tag === "RequestTooLarge"
        ? dashboardTokenErrorResponse("Request too large", 413)
        : dashboardTokenErrorResponse("Invalid JSON request body", 400)
    }
    const input = decodeDashboardTokenRequest(body.success)
    if (Result.isFailure(input)) {
      const issues = formatDashboardTokenIssues(input.failure.issue).issues
      return dashboardTokenErrorResponse(issues.map((issue) => issue.message).join("\n"), 400)
    }
    const result = yield* issueDashboardToken({ ...input.success, headers: request.headers })
    return Response.json(result, { headers: dashboardTokenHeaders })
  },
  Effect.catch((error) =>
    Effect.succeed(
      dashboardTokenErrorResponse(
        error.message,
        declaredHttpApiStatus(error) ?? 500,
        error._tag === "OrganizationApiKeysMissing" ? "NO_API_KEYS" : undefined,
      ),
    ),
  ),
  Effect.catchCause((cause) =>
    Effect.map(reportFailure("handleDashboardTokenRequest", cause), () =>
      dashboardTokenErrorResponse("Authentication is unavailable", 500),
    ),
  ),
)
