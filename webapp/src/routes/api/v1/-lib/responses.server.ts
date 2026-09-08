import type { RestApiErrorSchema } from "./shared.server"
import type { TenantError } from "@/db/tenant.server"
import { Data, Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { sqlState } from "../../../../db/lib/sqlstate.server.ts"

const restErrorTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
  405: "Method Not Allowed",
}
export class RestFault extends Data.TaggedError("RestFault")<{
  message: string
  restStatus: number
  issues?: typeof RestApiErrorSchema.Type.issues
  retryAfter?: number
}> {}

export function restFault(
  status: number,
  detail: string,
  options: Pick<RestFault, "issues" | "retryAfter"> = {},
): RestFault {
  return new RestFault({ restStatus: status, message: detail, ...options })
}

export function restErrorResponse(error: unknown, stage = "dispatch"): Response {
  const diagnosticCode = sqlState(error)
  if (error instanceof Error && "_tag" in error && error._tag === "TenantError") {
    const fault = error as TenantError
    error = restFault(
      { NotFound: 404, Conflict: 409, Forbidden: 403, Database: 500 }[fault.reason],
      fault.message,
    )
  }
  const fault = error instanceof RestFault ? error : undefined
  const status = fault?.restStatus ?? 500
  if (status === 500) {
    console.error("API request failed", { stage, status, sqlState: diagnosticCode ?? "unknown" })
  }
  const body = {
    type: "about:blank",
    title: restErrorTitles[status] ?? "Request Failed",
    status,
    detail: fault?.message ?? "The request could not be completed.",
    ...(fault?.issues ? { issues: fault.issues } : {}),
  } satisfies typeof RestApiErrorSchema.Type
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      ...(fault?.retryAfter ? { "Retry-After": String(fault.retryAfter) } : {}),
    },
  })
}

export function restHandleErrors(operation: string) {
  return Effect.catch((error: TenantError | RestFault) =>
    Effect.sync(() => HttpServerResponse.fromWeb(restErrorResponse(error, operation)))
  )
}

export function restResponseHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  headers.set("Access-Control-Allow-Origin", "*")
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "authorization, content-type, x-api-key")
  headers.set("Access-Control-Expose-Headers", "Location, Link, Retry-After")
  return new Response(response.body, { status: response.status, headers })
}
