import type { RestApiErrorSchema } from "./shared.server"
import type { TenantError } from "@/db/tenant.server"
import { ChatError } from "../../../../lib/chat/errors.server.ts"
import { Data, Duration, Effect } from "effect"
import type { RateLimiter } from "effect/unstable/persistence"
import { APP_HANDLE } from "../../../../lib/constants.ts"
import { HttpServerResponse } from "effect/unstable/http"
import { sqlState } from "../../../../db/lib/sqlstate.server.ts"

const restErrorTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
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
  cause?: unknown
}> {}

export function restFault(
  status: number,
  detail: string,
  options: Pick<RestFault, "issues" | "retryAfter" | "cause"> = {},
): RestFault {
  return new RestFault({ restStatus: status, message: detail, ...options })
}

export function restErrorResponse(error: unknown, stage = "dispatch"): Response {
  const diagnosticCode = sqlState(error)
  const errorType = error instanceof Error ? error.name : "UnknownError"
  if (error instanceof ChatError) {
    error = restFault(
      { InvalidInput: 400, NotFound: 404, Unavailable: 503 }[error.reason],
      error.message,
    )
  }
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
    console.error("API request failed", {
      stage,
      status,
      errorType,
      code: diagnosticCode ?? "unknown",
    })
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
      ...(status === 401 ? { "WWW-Authenticate": `Bearer realm="${APP_HANDLE}"` } : {}),
      ...(fault?.retryAfter ? { "Retry-After": String(fault.retryAfter) } : {}),
    },
  })
}

export function restHandleErrors(operation: string) {
  return Effect.catch((error: unknown) =>
    Effect.sync(() => HttpServerResponse.fromWeb(restErrorResponse(error, operation)))
  )
}

export function restRateLimitFault(error: RateLimiter.RateLimiterError): RestFault {
  return error.reason._tag === "RateLimitExceeded"
    ? restFault(429, "Request limit exceeded.", {
      retryAfter: Math.max(1, Math.ceil(Duration.toMillis(error.reason.retryAfter) / 1000)),
    })
    : restFault(500, "Request limit could not be checked.")
}

export function restResponseHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  const cache = headers.get("Cache-Control")
  if (!cache?.split(",").some((value) => value.trim().toLowerCase() === "no-store")) {
    headers.set("Cache-Control", cache ? `${cache}, no-store` : "no-store")
  }
  headers.set("Access-Control-Allow-Origin", "*")
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, content-type, x-api-key, last-event-id, x-run-id",
  )
  headers.set(
    "Access-Control-Expose-Headers",
    "Location, Link, Retry-After, Content-Disposition, WWW-Authenticate",
  )
  headers.set("Access-Control-Max-Age", "86400")
  return new Response(response.body, { status: response.status, headers })
}
