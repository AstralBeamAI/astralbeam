import { redirect } from "@tanstack/react-router"
import {
  getRequest,
  getRequestIP,
  getRequestUrl,
  setResponseHeader,
} from "@tanstack/react-start/server"
import { Effect, Result } from "effect"

import { isLoopbackProxyAddress } from "@/lib/utils.server"
import { ConfigureHttpsRequired, ConfigureRequestForbidden } from "./errors.ts"

export function isSameOriginConfigureRequest(request: Request, requestUrl: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false
  const source = request.headers.get("origin") ?? request.headers.get("referer")
  if (source === null) return false
  const sourceUrl = Result.try(() => new URL(source))
  return Result.isSuccess(sourceUrl) && sourceUrl.success.origin === requestUrl.origin
}

/**
 * Marks responses uncacheable at once, and fails for a request `/configure` must not serve. A page
 * load over plain HTTP in production redirects to HTTPS, which the router needs thrown.
 */
export function checkConfigureRequest(): Effect.Effect<
  void,
  ConfigureHttpsRequired | ConfigureRequestForbidden
> {
  setResponseHeader("Cache-Control", "no-store")
  setResponseHeader("Pragma", "no-cache")
  // Stricter than the application-wide default, so it stays here.
  setResponseHeader("Referrer-Policy", "no-referrer")

  const request = getRequest()
  // The forwarded host and protocol are only the ingress's when the connection came from it;
  // otherwise a direct caller could satisfy the HTTPS requirement below with a header of its own.
  const forwardedByIngress = isLoopbackProxyAddress(getRequestIP())
  const requestUrl = getRequestUrl({
    xForwardedHost: forwardedByIngress,
    xForwardedProto: forwardedByIngress,
  })
  if (import.meta.env.PROD && requestUrl.protocol !== "https:") {
    if (["GET", "HEAD"].includes(request.method.toUpperCase())) {
      const httpsUrl = new URL(requestUrl)
      httpsUrl.protocol = "https:"
      throw redirect({ href: httpsUrl.href, statusCode: 307 })
    }
    return Effect.fail(new ConfigureHttpsRequired())
  }
  return isSameOriginConfigureRequest(request, requestUrl)
    ? Effect.void
    : Effect.fail(new ConfigureRequestForbidden())
}
