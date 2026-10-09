import { Cause, Effect, Layer, Option, SchemaIssue, Scope } from "effect"
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"

import { Database } from "@/db/database.server"
import { Auth } from "@/lib/auth/auth.server"
import { DatabaseRateLimiter } from "@/db/lib/rate-limiter.server"
import { Config } from "@/lib/config/config.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { getAppLayer, getAppRuntime } from "@/lib/runtime/runtime.server"
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
import { uploadHandlers } from "../chat/-lib/uploads.server"
import { chatThreadHandlers } from "../chat/-lib/threads.server"
import { authenticateRestRequest } from "./auth.server"
import { threadDirectoryHandlers } from "./thread.server"
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
    const services = yield* Effect.context<Auth | Database | DatabaseRateLimiter | Tenants>()
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
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-api-key, last-event-id, x-run-id, idempotency-key",
  "Access-Control-Expose-Headers":
    "Location, Link, Retry-After, Content-Disposition, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
}

/** Every v1 response is uncacheable and readable cross-origin, including errors. */
export function restResponseHeaders(response: HttpServerResponse.HttpServerResponse) {
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

/** Owns setup, CORS, cache headers, and failures outside every endpoint. */
const RestRouterBoundary = Layer.unwrap(
  Effect.map(Config, (config) =>
    HttpRouter.middleware(
      (httpEffect) =>
        Effect.gen(function* () {
          const { setupComplete } = yield* config.setupState
          if (!setupComplete) return restProblemResponse(new RestSetupRequired())
          return restProblemOnly(yield* httpEffect)
        }).pipe(Effect.catchCause(restRouterFailure), Effect.map(restResponseHeaders)),
      { global: true },
    ),
  ),
)

/** The v1 routes and their boundaries, before the application services they run on. */
export const ApiV1Routes = Layer.mergeAll(
  HttpApiBuilder.layer(ApiV1).pipe(
    Layer.provide([
      tenantHandlers(ApiV1),
      tenantUserHandlers(ApiV1),
      chatHandlers(ApiV1),
      uploadHandlers(ApiV1),
      chatThreadHandlers(ApiV1),
      threadDirectoryHandlers(ApiV1),
      currentUserHandlers(ApiV1),
      organizationHandlers(ApiV1),
    ]),
    Layer.provide([ApiBoundaryLive, RestAuthorizationLive]),
  ),
  RestRouterBoundary,
)

// The shared memo map reuses the app runtime's services, and the runtime's scope owns the handler
// so disposing the runtime also releases the services the handler holds.
function makeApiV1WebHandler() {
  const runtime = getAppRuntime()
  const webHandler = HttpRouter.toWebHandler(
    ApiV1Routes.pipe(Layer.provideMerge(getAppLayer()), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true, memoMap: runtime.memoMap },
  )
  const disposeWebHandler = Effect.promise(() => {
    if (apiV1WebHandler === webHandler) apiV1WebHandler = undefined
    return webHandler.dispose()
  })
  Effect.runSync(Scope.addFinalizer(runtime.scope, disposeWebHandler))
  return webHandler
}

let apiV1WebHandler: ReturnType<typeof makeApiV1WebHandler> | undefined

export function getApiV1WebHandler() {
  return (apiV1WebHandler ??= makeApiV1WebHandler())
}

import.meta.hot?.dispose(() => void apiV1WebHandler?.dispose())
