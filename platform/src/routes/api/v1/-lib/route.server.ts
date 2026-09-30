import { Cause, Effect } from "effect"
import { HttpServerResponse } from "effect/http"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials.server"
import { reportFailure } from "@/lib/runtime/failure-report.server"
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
  try {
    return await getApiV1WebHandler().handler(request)
  } catch (error) {
    // The handler rejects only when its services fail to build.
    const reference = await Effect.runPromise(reportFailure("handleApiV1Request", Cause.die(error)))
    return restWebResponse(restProblemResponse(new RestInternalError({ reference })))
  }
}
