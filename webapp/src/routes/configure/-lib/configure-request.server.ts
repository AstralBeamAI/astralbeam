import {
  getRequest,
  getRequestUrl,
  setResponseHeader,
  setResponseStatus,
} from "@tanstack/react-start/server"
import { redirect } from "@tanstack/react-router"

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
  setResponseHeader("X-Frame-Options", "DENY")
  setResponseHeader("X-Content-Type-Options", "nosniff")
  setResponseHeader("Referrer-Policy", "no-referrer")
  setResponseHeader("Content-Security-Policy", "frame-ancestors 'none'")

  const request = getRequest()
  const requestUrl = getRequestUrl({ xForwardedHost: true, xForwardedProto: true })
  if (import.meta.env.PROD && requestUrl.protocol !== "https:") {
    if (["GET", "HEAD"].includes(request.method.toUpperCase())) {
      const httpsUrl = new URL(requestUrl)
      httpsUrl.protocol = "https:"
      throw redirect({ href: httpsUrl.href, statusCode: 307 })
    }
    setResponseStatus(400)
    throw new Error("HTTPS is required")
  }
  if (import.meta.env.PROD) {
    setResponseHeader("Strict-Transport-Security", "max-age=31536000")
  }
  if (!isSameOriginConfigureRequest(request, requestUrl)) {
    setResponseStatus(403)
    throw new Error("Forbidden")
  }
}
