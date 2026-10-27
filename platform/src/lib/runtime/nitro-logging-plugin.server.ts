import { Cause, Effect } from "effect"
import { getEventContext, HTTPError } from "nitro/h3"
import type { NitroAppPlugin } from "nitro/types"

import { reportFailure } from "./failure-report.server.ts"
import { serverLoggerLayer } from "./logging.server.ts"

type RequestLogContext = {
  requestId?: string
  requestStartedAt?: number
}

const nitroLoggingPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender) return
  // Validate the operator's log level before registering hooks that also use the logger.
  Effect.runSync(Effect.void.pipe(Effect.provide(serverLoggerLayer)))
  nitro.hooks.hook("request", (event) => {
    const requestId = crypto.randomUUID()
    Object.assign(getEventContext<RequestLogContext>(event), {
      requestId,
      requestStartedAt: performance.now(),
    })
    // Replace caller-supplied IDs so correlation never logs arbitrary header values.
    event.req.headers.set("X-Request-Id", requestId)
    Effect.runSync(
      Effect.logDebug("HTTP request started").pipe(
        Effect.annotateLogs({
          event: "request.started",
          requestId,
          method: event.req.method,
          path: new URL(event.req.url).pathname,
        }),
        Effect.provide(serverLoggerLayer),
      ),
    )
  })
  // Measure response-ready latency without waiting for a streamed body to finish.
  nitro.hooks.hook("response", (response, event) => {
    // Early framework rejections may bypass the request hook and leave its metadata absent.
    const context = getEventContext<RequestLogContext>(event)
    const requestId = (context.requestId ??= crypto.randomUUID())
    const path = new URL(event.req.url).pathname
    const status = response.status
    response.headers.set("X-Request-Id", requestId)
    const log =
      status >= 500
        ? Effect.logError
        : status >= 400
          ? Effect.logWarning
          : path.startsWith("/assets/") || path === "/favicon.ico" || path === "/api/status"
            ? Effect.logDebug
            : Effect.logInfo
    Effect.runSync(
      log("HTTP response ready").pipe(
        Effect.annotateLogs({
          event: "response.ready",
          requestId,
          method: event.req.method,
          path,
          status,
          durationMs:
            context.requestStartedAt === undefined
              ? undefined
              : performance.now() - context.requestStartedAt,
        }),
        Effect.provide(serverLoggerLayer),
      ),
    )
  })
  nitro.hooks.hook("error", (error, { event }) => {
    if (event?.req.signal.aborted || (HTTPError.isError(error) && error.status < 500)) return
    const requestId = event
      ? (getEventContext<RequestLogContext>(event).requestId ??= crypto.randomUUID())
      : undefined
    Effect.runSync(
      reportFailure("httpRequest", Cause.die(error)).pipe(
        Effect.annotateLogs({ requestId }),
        Effect.provide(serverLoggerLayer),
      ),
    )
  })
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default nitroLoggingPlugin
