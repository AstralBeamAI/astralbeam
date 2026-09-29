import { Cause, Effect, Layer, Option, Schema, SchemaIssue } from "effect"
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"

import { Database } from "@/db/database.server"
import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { isSetupComplete } from "@/lib/config/state.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { AppLayer, getAppRuntime } from "@/lib/runtime/runtime.server"
import { Tenants } from "@/lib/tenants/tenants.server"
import { ApiV1 } from "./contract.server"
import {
  ApiBoundary,
  isRestError,
  RestAuthorization,
  RestProblem,
  restErrorStatus,
  restProblemResponse,
  RestScope,
} from "./shared.server"
import { currentUserHandlers } from "./current-user.server"
import { organizationHandlers } from "./organization.server"
import { chatHandlers } from "../chat/-lib/chat.server"
import { authenticateRestRequest } from "./auth.server"
import { tenantHandlers } from "./tenant.server"
import { tenantUserHandlers } from "./tenant-user.server"
import {
  RestInternalError,
  RestInvalidBody,
  RestInvalidParameters,
  RestQueryNotAccepted,
  RestResourceNotFound,
  RestSetupRequired,
  RestUnsupportedEncoding,
  RestUnsupportedMediaType,
} from "./errors.ts"

const formatRestIssues = SchemaIssue.makeFormatterStandardSchemaV1()

/** The setup check itself failed, which the router reports as an internal error. */
class RestSetupCheckFailed extends Schema.TaggedError<RestSetupCheckFailed>()(
  "RestSetupCheckFailed",
  { cause: Schema.Defect() },
) {}

function restValidationError(error: HttpApiError.HttpApiSchemaError) {
  const body = error.kind === "Payload"
  const issues = formatRestIssues(error.cause.issue).issues.map((issue) => ({
    path: [
      body ? "body" : "parameters",
      ...(issue.path ?? []).map((segment) => (typeof segment === "object" ? segment.key : segment)),
    ].join("."),
    message: issue.message,
  }))
  return body ? new RestInvalidBody({ issues }) : new RestInvalidParameters({ issues })
}

/**
 * Keeps declared REST failures and request validation typed. Reports everything else once and
 * answers it with the reference of that report.
 */
function restBoundaryFailure(cause: Cause.Cause<unknown>, operation: string) {
  if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure) && !Cause.hasDies(cause)) {
    const error = failure.value
    if (HttpApiError.HttpApiSchemaError.is(error)) {
      if (error.kind !== "Body" && error.kind !== "ResponseHeaders") {
        return Effect.fail(restValidationError(error))
      }
    } else if (isRestError(error) && restErrorStatus(error) !== 500) {
      return Effect.fail(error)
    }
  }
  return reportFailure(operation, cause).pipe(
    Effect.flatMap((reference) => Effect.fail(new RestInternalError({ reference }))),
  )
}

const ApiBoundaryLive = Layer.succeed(ApiBoundary, (httpEffect, { endpoint }) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!endpoint.query && new URL(request.url, "http://localhost").search) {
      return yield* new RestQueryNotAccepted()
    }
    if (endpoint.payload.size > 0) {
      const mediaType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()
      if (mediaType !== "application/json") return yield* new RestUnsupportedMediaType()
      const encoding = request.headers["content-encoding"]
      if (encoding && encoding !== "identity") return yield* new RestUnsupportedEncoding()
    }
    return yield* httpEffect
  }).pipe(Effect.catchCause((cause) => restBoundaryFailure(cause, endpoint.identifier))),
)

const RestAuthorizationLive = Layer.effect(
  RestAuthorization,
  Effect.gen(function* () {
    const services = yield* Effect.context<Database | DatabaseRateLimiter | Tenants>()
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
        const scope = yield* authenticateRestRequest(native).pipe(Effect.provideContext(services))
        return yield* Effect.provideService(httpEffect, RestScope, scope)
      })
  }),
)

const REST_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-key, last-event-id, x-run-id",
  "Access-Control-Expose-Headers":
    "Location, Link, Retry-After, Content-Disposition, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
}

/** Every v1 response is uncacheable and readable cross-origin, including errors. */
function restResponseHeaders(response: HttpServerResponse.HttpServerResponse) {
  const cache = response.headers["cache-control"]
  const noStore = cache?.split(",").some((value) => value.trim().toLowerCase() === "no-store")
  return HttpServerResponse.setHeaders(response, {
    ...REST_CORS_HEADERS,
    ...(noStore ? {} : { "Cache-Control": cache ? `${cache}, no-store` : "no-store" }),
  })
}

// Router replies such as an unknown path carry no problem body until this rewrites them.
function restProblemOnly(response: HttpServerResponse.HttpServerResponse) {
  if (response.status < 400) return response
  if (response.headers["content-type"]?.includes("application/problem+json")) return response
  return restProblemResponse(
    response.status === 404
      ? new RestResourceNotFound()
      : new RestProblem({
          status: response.status,
          message: "The request could not be completed.",
        }),
  )
}

const restSetupGate = Effect.gen(function* () {
  if (getDatabaseBootstrapIssues().length > 0) return false
  // Seam: setup state stays Promise-based until the config module exposes an Effect service.
  return yield* Effect.tryPromise({
    try: () => isSetupComplete(),
    catch: (cause) => new RestSetupCheckFailed({ cause }),
  }).pipe(Effect.orDie)
})

/** Answers an unknown path with a problem body and reports defects once. */
function restRouterFailure<E>(
  cause: Cause.Cause<E>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E> {
  if (Cause.hasDies(cause)) {
    return reportFailure("handleApiV1Request", cause).pipe(
      Effect.map((reference) => restProblemResponse(new RestInternalError({ reference }))),
    )
  }
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure) &&
    HttpServerError.isHttpServerError(failure.value) &&
    failure.value.reason._tag === "RouteNotFound"
    ? Effect.succeed(restProblemResponse(new RestResourceNotFound()))
    : Effect.failCause(cause)
}

/** Owns preflight, setup, CORS, cache headers, and failures outside every endpoint. */
const RestRouterBoundary = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.method === "OPTIONS") return HttpServerResponse.empty({ status: 204 })
      if (!(yield* restSetupGate)) return restProblemResponse(new RestSetupRequired())
      return restProblemOnly(yield* httpEffect)
    }).pipe(Effect.catchCause(restRouterFailure), Effect.map(restResponseHeaders)),
  { global: true },
)

/** The v1 routes and their boundaries, before the application services they run on. */
export const ApiV1Routes = Layer.mergeAll(
  HttpApiBuilder.layer(ApiV1).pipe(
    Layer.provide([
      tenantHandlers(ApiV1),
      tenantUserHandlers(ApiV1),
      chatHandlers(ApiV1),
      currentUserHandlers(ApiV1),
      organizationHandlers(ApiV1),
    ]),
    Layer.provide([ApiBoundaryLive, RestAuthorizationLive]),
  ),
  RestRouterBoundary,
)

// The shared memo map reuses the app runtime's services instead of building another set.
function makeApiV1WebHandler() {
  return HttpRouter.toWebHandler(
    ApiV1Routes.pipe(Layer.provideMerge(AppLayer), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true, memoMap: getAppRuntime().memoMap },
  )
}

let apiV1WebHandler: ReturnType<typeof makeApiV1WebHandler> | undefined

export function getApiV1WebHandler() {
  return (apiV1WebHandler ??= makeApiV1WebHandler())
}

import.meta.hot?.dispose(() => void apiV1WebHandler?.dispose())
