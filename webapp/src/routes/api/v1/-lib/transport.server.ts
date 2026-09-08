import { Cause, Effect, Layer, SchemaIssue } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { ApiV1 } from "./contract.server"
import { ApiBoundary, RestAuthorization, restScope } from "./shared.server"
import { chatHandlers } from "../chat/-lib/chat.server"
import { authenticateRestRequest } from "./auth.server"
import { tenantHandlers } from "./tenant.server"
import { tenantUserHandlers } from "./tenant-user.server"
import { effectDatabase, runDatabaseEffect } from "@/db"
import { restErrorResponse, RestFault, restFault, restResponseHeaders } from "./responses.server"

function restBoundaryFailure(cause: Cause.Cause<unknown>, operation: string) {
  const error = Cause.squash(cause)
  if (error instanceof RestFault) return restErrorResponse(error)
  if (HttpApiError.HttpApiSchemaError.is(error)) {
    const body = error.kind === "Payload"
    if (error.kind === "Body" || error.kind === "ResponseHeaders") {
      return restErrorResponse(error, operation)
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
  return restErrorResponse(error, operation)
}
const RestAuthorizationLive = Layer.succeed(
  RestAuthorization,
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const native = yield* HttpServerRequest.toWeb(request)
      const scope = yield* authenticateRestRequest(native)
      return yield* httpEffect.pipe(Effect.provideService(restScope, scope))
    }).pipe(restBoundaryErrors("authentication")),
)

const ApiBoundaryLive = Layer.succeed(
  ApiBoundary,
  (httpEffect, { endpoint }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (!endpoint.query && new URL(request.url, "http://localhost").search) {
        return yield* Effect.fail(restFault(400, "This endpoint does not accept query parameters."))
      }
      return yield* httpEffect
    }).pipe(restBoundaryErrors(endpoint.identifier)),
)

function restBoundaryErrors(operation: string) {
  return Effect.catchCause((cause) =>
    Effect.sync(() => HttpServerResponse.fromWeb(restBoundaryFailure(cause, operation)))
  )
}

// Borrow the existing ManagedRuntime service; this does not build another database pool.
const RestDatabaseLayer = Layer.effect(
  effectDatabase,
  Effect.promise(() => runDatabaseEffect(effectDatabase)),
)

export const apiV1WebHandler = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(ApiV1).pipe(
    Layer.provide([tenantHandlers(ApiV1), tenantUserHandlers(ApiV1), chatHandlers(ApiV1)]),
    Layer.provide([ApiBoundaryLive, RestAuthorizationLive]),
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
    response = await apiV1WebHandler.handler(prepared)
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
