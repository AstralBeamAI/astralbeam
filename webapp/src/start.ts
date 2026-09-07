import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"

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

const responseSecurityHeadersMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, pathname, next }) => {
    const result = await next()
    applyResponseSecurityHeaders(result.response.headers, request, pathname)
    return result
  },
)

// Declaring request middleware replaces the CSRF middleware the framework installs on its own.
// https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts
const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })

export const startInstance = createStart(() => ({
  // The header middleware runs outermost so a rejected request is answered with them too.
  requestMiddleware: [responseSecurityHeadersMiddleware, csrfMiddleware],
}))
