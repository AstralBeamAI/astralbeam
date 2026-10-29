import { Cause, Context, Effect, References, Tracer } from "effect"
import * as OtelTracer from "@effect/opentelemetry/OtelTracer"
import { HttpMiddleware, HttpServerResponse } from "effect/http"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { serverLoggerLayer } from "@/lib/runtime/logging.server"
import { getHttpServerSpan } from "@/lib/runtime/tracing-context.server"
import { RestInternalError, RestSetupRequired } from "./errors.ts"
import { restProblemResponse } from "./shared.server"
import { getApiV1WebHandler, restResponseHeaders } from "./transport.server"

function restWebResponse(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.toWeb(restResponseHeaders(response))
}

/**
 * The one entrypoint for v1 and its aliases. Preflight and missing database variables are answered
 * before the web handler builds the services that need them, and the handler answers the rest.
 */
export async function handleApiV1Request(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return restWebResponse(HttpServerResponse.empty({ status: 204 }))
  }
  if (getDatabaseBootstrapIssues().length > 0) {
    return restWebResponse(restProblemResponse(new RestSetupRequired()))
  }
  const annotations = { requestId: request.headers.get("x-request-id") }
  let context = Context.make(References.CurrentLogAnnotations, annotations)
  const parent = getHttpServerSpan(request)?.spanContext()
  if (parent) {
    context = context.pipe(
      Context.add(Tracer.ParentSpan, OtelTracer.makeExternalSpan(parent)),
      // Nitro already owns the server span and incoming traceparent extraction.
      Context.add(HttpMiddleware.TracerDisabledWhen, () => true),
    )
  }
  try {
    return await getApiV1WebHandler().handler(request, context)
  } catch (error) {
    // The handler rejects only when its services fail to build.
    const reference = Effect.runSync(
      reportFailure("handleApiV1Request", Cause.die(error)).pipe(
        Effect.annotateLogs(annotations),
        Effect.provide(serverLoggerLayer),
      ),
    )
    return restWebResponse(restProblemResponse(new RestInternalError({ reference })))
  }
}
