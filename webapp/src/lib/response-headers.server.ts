import type { NitroAppPlugin } from "nitro/types"

// The SDK widget loads these routes from a customer's own origin, so they must stay framable and
// keep the CSP that `/api/chat/files` sets on downloaded artifacts.
const EMBEDDED_API_BASE_PATH = "/api/chat"

// One year is the shortest max-age the preload list accepts.
// https://hstspreload.org/#deployment-recommendations
const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains"

// Only features the app never uses; anything unlisted keeps its browser default.
// https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy
const PERMISSIONS_POLICY =
  "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()"

function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true
  // A forged value only adds a header browsers ignore over plain HTTP, so the proxy's protocol
  // does not need the loopback check that `/configure` applies before enforcing HTTPS.
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
}

function isEmbeddedApiPath(pathname: string): boolean {
  return pathname === EMBEDDED_API_BASE_PATH ||
    pathname.startsWith(`${EMBEDDED_API_BASE_PATH}/`)
}

export function applyResponseSecurityHeaders(
  headers: Headers,
  request: Request,
  pathname: string,
): void {
  if (pathname === "/api/openapi.json") {
    headers.set("Cache-Control", "public, no-cache")
    headers.set("Access-Control-Allow-Origin", "*")
  }
  if (
    (pathname === "/docs" || pathname.startsWith("/docs/")) && !headers.has("Cache-Control")
  ) {
    headers.set("Cache-Control", "public, no-cache")
  }
  if (isSecureRequest(request)) headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY)
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  headers.set("Permissions-Policy", PERMISSIONS_POLICY)
  if (isEmbeddedApiPath(pathname)) return
  headers.set("X-Frame-Options", "DENY")
  // Script and style directives are deliberately absent: the framework's inline bootstrap,
  // Turnstile, and the docs pages each need their own allowlist audit first.
  headers.set("Content-Security-Policy", "frame-ancestors 'none'")
}

const responseHeadersPlugin: NitroAppPlugin = (nitro) => {
  nitro.hooks.hook("response", (response, event) => {
    const pathname = new URL(event.req.url).pathname
    applyResponseSecurityHeaders(response.headers, event.req, pathname)
  })
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default responseHeadersPlugin
