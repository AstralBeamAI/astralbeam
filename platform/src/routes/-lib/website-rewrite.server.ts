import { getSessionCookie } from "better-auth/cookies"
import { Effect } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { Config } from "@/lib/config/config"
import { runRouteEffect } from "@/lib/runtime/server-fn.server"

// Website routes served at the same path. Keep in step with `prerenderRoutes` in www/vite.config.ts.
const WEBSITE_PATHS = new Set([
  "/home",
  "/terms",
  "/privacy",
  "/favicon.png",
  "/og-image.png",
  "/licenses.txt",
  "/llms.txt",
  "/site.webmanifest",
  "/sitemap.xml",
])
const WEBSITE_PATH_PREFIXES = ["/website-assets/", "/demo/"]
// Conditional request headers let the website answer a cached copy with 304.
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "if-modified-since",
  "if-none-match",
]

const websiteUrlSetting = Effect.flatMap(Config, (config) => config.get("website_url")).pipe(
  Effect.catchCause(() => Effect.succeed(undefined)),
)

/** The configured website origin, unset before setup and while the database is unreachable. */
export function readWebsiteUrl(): Promise<string | undefined> {
  if (getDatabaseBootstrapIssues().length > 0) return Promise.resolve(undefined)
  return runRouteEffect(websiteUrlSetting)
}

function isWebsitePath(request: Request, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false
  if (pathname === "/") return getSessionCookie(request) === null
  return (
    WEBSITE_PATHS.has(pathname) ||
    WEBSITE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}

function websiteResponse(upstream: Response, pathname: string): Response {
  const headers = new Headers(upstream.headers)
  // fetch decodes the body, so the upstream encoding and length no longer describe it.
  headers.delete("content-encoding")
  headers.delete("content-length")
  if (pathname === "/") {
    // Signed-in visitors get the dashboard at this URL, so shared caches must not keep this page.
    headers.set("Cache-Control", "private, no-cache")
    headers.append("Vary", "Cookie")
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

/**
 * Serves the separately hosted website's pages under this origin, the way Next.js rewrites do.
 * `/` shows the website's home page until a session cookie exists, and `/home` always does.
 */
export function rewriteToWebsite(
  request: Request,
  pathname: string,
): Promise<Response | undefined> {
  if (!isWebsitePath(request, pathname) || getDatabaseBootstrapIssues().length > 0) {
    return Promise.resolve(undefined)
  }
  return runRouteEffect(
    Effect.gen(function* () {
      const websiteUrl = yield* websiteUrlSetting
      if (websiteUrl === undefined) return undefined
      const url = new URL(pathname + new URL(request.url).search, websiteUrl)
      const headers = new Headers()
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      return yield* Effect.tryPromise({
        try: (signal) =>
          fetch(url, { method: request.method, headers, redirect: "manual", signal }),
        catch: (cause) => cause,
      }).pipe(
        Effect.map((upstream) => websiteResponse(upstream, pathname)),
        Effect.catch((error) =>
          Effect.logWarning("Website request failed", error).pipe(
            Effect.as(new Response("Bad Gateway", { status: 502 })),
          ),
        ),
      )
    }),
  )
}
