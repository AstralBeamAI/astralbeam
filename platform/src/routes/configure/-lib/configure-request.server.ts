import {
  getRequest,
  getRequestIP,
  getRequestUrl,
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/react-start/server"
import { redirect } from "@tanstack/react-router"

import { isLoopbackProxyAddress } from "@/lib/utils.server"

export function isSameOriginConfigureRequest(request: Request, requestUrl: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false
  const source = request.headers.get("origin") ?? request.headers.get("referer")
  try {
    return source !== null && new URL(source).origin === requestUrl.origin
  } catch {
    return false
  }
}

export function requireConfigureRequest(): void {
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
    setResponseStatus(400)
    throw new Error("HTTPS is required")
  }
  if (!isSameOriginConfigureRequest(request, requestUrl)) {
    setResponseStatus(403)
    throw new Error("Forbidden")
  }
}
