import type { NitroAppPlugin } from "nitro/types"

import { APP_HANDLE } from "@/lib/constants"
import { IS_DEVELOPMENT_SERVER } from "@/lib/runtime/environment.server"
import { resolveAppOrigin } from "@/routes/-lib/app-origin.server"

const PUBLIC_LOGO_PATH = new RegExp(
  `^/${APP_HANDLE}-(?:logo|wordmark)-(?:light|dark)\\.(?:svg|png)$`,
  "u",
)

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

export function applyResponseSecurityHeaders(
  headers: Headers,
  request: Request,
  pathname: string,
  status: number,
): void {
  // Vary on encoding even when Nitro serves the uncompressed representation.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary
  headers.append("Vary", "Accept-Encoding")
  if (pathname === "/api/openapi.json") {
    headers.set("Access-Control-Allow-Origin", "*")
  }
  if (
    (PUBLIC_LOGO_PATH.test(pathname) || pathname === "/api/openapi.json") &&
    (status === 200 || status === 304) &&
    (request.method === "GET" || request.method === "HEAD") &&
    !headers.has("Cache-Control")
  ) {
    // Stable URLs can change between releases, so revalidate after their short freshness window.
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#must-revalidate
    headers.set(
      "Cache-Control",
      IS_DEVELOPMENT_SERVER ? "no-cache" : "public, max-age=300, must-revalidate",
    )
  }
  if ((pathname === "/docs" || pathname.startsWith("/docs/")) && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, no-cache")
  }
  if (isSecureRequest(request)) headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY)
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  headers.set("Permissions-Policy", PERMISSIONS_POLICY)
  headers.set("X-Frame-Options", "DENY")
  // Browsers enforce both policies, preserving route-specific restrictions such as artifact sandboxing.
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#multiple_content_security_policies
  headers.append("Content-Security-Policy", "frame-ancestors 'none'")
}

const responseHeadersPlugin: NitroAppPlugin = (nitro) => {
  nitro.hooks.hook("response", async (response, event) => {
    const pathname = new URL(event.req.url).pathname
    applyResponseSecurityHeaders(response.headers, event.req, pathname, response.status)
    if (
      response.ok &&
      (pathname === "/docs" || pathname === "/docs.md" || pathname.startsWith("/docs/")) &&
      /^text\/(?:html|markdown)\b/u.test(response.headers.get("Content-Type") ?? "")
    ) {
      // Runtime HTTP canonicals keep prerendered docs portable between deployments.
      // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls#rel-canonical-http-header
      const origin = await resolveAppOrigin(event.req)
      const path = pathname.replace(/\/$/u, "").replace(/\.md$/u, "")
      response.headers.set("Link", `<${new URL(path, origin).href}>; rel="canonical"`)
    }
  })
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default responseHeadersPlugin
