import { createFileRoute } from "@tanstack/react-router"
import { Effect, Result, Schema, SchemaIssue } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { issueDashboardToken } from "@/lib/auth/dashboard-token.server"
import { Config } from "@/lib/config/config.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { getAppRuntime } from "@/lib/runtime/runtime.server"
import { httpStatus } from "@/lib/runtime/server-fn.server"
import { SlugSchema, validationParseOptions } from "@/lib/schemas"
import { readRequestJson, RequestTooLargeError } from "../-lib/request-body.server"

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

function dashboardTokenErrorResponse(error: string, status: number, code?: string) {
  return Response.json({ error, code }, { status, headers: dashboardTokenHeaders })
}

const handleDashboardTokenRequest = Effect.fn("handleDashboardTokenRequest")(
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
    const body = yield* Effect.result(
      Effect.tryPromise({ try: () => readRequestJson(request, 1024), catch: (cause) => cause }),
    )
    if (Result.isFailure(body)) {
      return body.failure instanceof RequestTooLargeError
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
        httpStatus(error),
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

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: ({ request }) =>
        getDatabaseBootstrapIssues().length > 0
          ? dashboardTokenErrorResponse("Application is not configured", 503)
          : getAppRuntime().runPromise(handleDashboardTokenRequest(request)),
    },
  },
})
