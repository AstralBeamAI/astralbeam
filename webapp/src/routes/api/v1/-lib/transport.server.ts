import { Cause, Effect, Layer, SchemaIssue } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RestBoundary, restScope, TenantRestApi } from "./contract.server"
import { authenticateRestRequest } from "./auth.server"
import { RestDatabaseLayer, TenantRestHandlers } from "./handlers.server"
import { restErrorResponse, RestFault, restFault, restResponseHeaders } from "./responses.server"
import { sqlState } from "@/db/lib/sqlstate.server"

function restBoundaryFailure(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause)
  if (error instanceof RestFault) return restErrorResponse(error)
  if (HttpApiError.HttpApiSchemaError.is(error)) {
    const body = error.kind === "Payload"
    if (error.kind === "Body" || error.kind === "ResponseHeaders") {
      return restErrorResponse(undefined)
    }
    const issues = SchemaIssue.makeFormatterStandardSchemaV1()(error.cause.issue).issues.map((
      issue,
    ) => ({
      path: [
        body ? "body" : "parameters",
        ...(issue.path ?? []).map((segment) => typeof segment === "object" ? segment.key : segment),
      ].join("."),
      message: issue.message,
    }))
    return restErrorResponse(
      restFault(body ? 422 : 400, body ? "Invalid request body." : "Invalid request parameters.", {
        issues,
      }),
    )
  }
  return restErrorResponse(error)
}
const RestBoundaryLive = Layer.succeed(
  RestBoundary,
  (httpEffect, { endpoint }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const native = yield* HttpServerRequest.toWeb(request)
      const scope = yield* authenticateRestRequest(native)
      if (!endpoint.query && new URL(native.url).search) {
        return yield* Effect.fail(restFault(400, "This endpoint does not accept query parameters."))
      }
      return yield* httpEffect.pipe(Effect.provideService(restScope, scope))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const response = restBoundaryFailure(cause)
          if (response.status >= 500) {
            yield* Effect.logError("Management API request failed", {
              operation: endpoint.identifier,
              status: response.status,
              sqlState: sqlState(cause) ?? "unknown",
            })
          }
          return HttpServerResponse.fromWeb(response)
        })
      ),
    ),
)

export const tenantRestWebHandler = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(TenantRestApi).pipe(
    Layer.provide(TenantRestHandlers),
    Layer.provide(RestBoundaryLive),
    Layer.provide(RestDatabaseLayer),
    HttpRouter.provideRequest(RestDatabaseLayer),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)

function prepareRestRequest(request: Request): Request {
  if (request.method !== "POST" && request.method !== "PATCH") return request
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) throw restFault(415, "Use application/json.")
  if (
    request.headers.has("content-encoding") &&
    request.headers.get("content-encoding") !== "identity"
  ) throw restFault(415, "Content encoding is not supported.")
  return request
}

export async function dispatchRestRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return restResponseHeaders(new Response(null, { status: 204 }))
  let response: Response
  try {
    const prepared = prepareRestRequest(request)
    response = await tenantRestWebHandler.handler(prepared)
    if (
      response.status >= 400 &&
      !response.headers.get("content-type")?.includes("application/problem+json")
    ) {
      response = restErrorResponse(
        restFault(
          response.status,
          response.status === 404 ? "Resource not found." : "The request could not be completed.",
        ),
      )
    }
  } catch (error) {
    response = restErrorResponse(error)
  }
  return restResponseHeaders(response)
}
