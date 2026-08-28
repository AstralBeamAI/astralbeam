import "@tanstack/react-start/server-only"

import { createMiddleware } from "@tanstack/react-start"

const DEVELOPMENT_ROUTE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

export interface DevelopmentRouteDocumentOptions {
  bodyHtml: string
  description: string
  heading: string
  navigationHtml?: string
  title: string
}

type DevelopmentRouteResponseFactory = () => Promise<Response> | Response

export function developmentRouteResponseHeaders(contentType: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-security-policy": DEVELOPMENT_ROUTE_CONTENT_SECURITY_POLICY,
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  })
}

export function developmentRouteNotFoundResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: developmentRouteResponseHeaders("text/plain; charset=utf-8"),
  })
}

async function developmentRouteHeadResponse(response: Response): Promise<Response> {
  const contentLength = (await response.arrayBuffer()).byteLength
  const headers = new Headers(response.headers)
  headers.set("content-length", String(contentLength))
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function handleDevelopmentRouteNotFoundRequest(
  request: Request,
): Promise<Response> {
  const response = developmentRouteNotFoundResponse()
  return request.method === "HEAD" ? await developmentRouteHeadResponse(response) : response
}

export const developmentOnlyRouteMiddleware = createMiddleware().server(
  ({ next, request }) => {
    if (__DEV_UTILITIES__) return next()

    return handleDevelopmentRouteNotFoundRequest(request)
  },
)

export async function handleDevelopmentRouteRequest(
  request: Request,
  getResponse: DevelopmentRouteResponseFactory,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = developmentRouteResponseHeaders("text/plain; charset=utf-8")
    headers.set("allow", "GET, HEAD")
    return new Response("Method not allowed", { status: 405, headers })
  }

  const response = await getResponse()
  if (request.method === "GET") return response

  return developmentRouteHeadResponse(response)
}

export function escapeDevelopmentRouteHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderDevelopmentRouteDocument(
  options: DevelopmentRouteDocumentOptions,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeDevelopmentRouteHtml(options.title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: Canvas; color: CanvasText; }
      main { width: min(48rem, calc(100% - 2rem)); margin: 4rem auto; }
      nav { margin-bottom: 1.5rem; }
      h1 { margin: 0; font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -0.035em; }
      p { color: color-mix(in srgb, CanvasText 72%, transparent); line-height: 1.6; }
      a { color: LinkText; text-underline-offset: 0.2em; }
      .tools { display: grid; gap: 0.75rem; margin: 2rem 0 0; padding: 0; list-style: none; }
      .tool { padding: 1rem 1.125rem; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 0.75rem; }
      .tool p { margin: 0.35rem 0 0; }
      .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.75rem; }
      .secondary { color: color-mix(in srgb, LinkText 70%, CanvasText); font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <main>
      ${options.navigationHtml ?? ""}
      <h1>${escapeDevelopmentRouteHtml(options.heading)}</h1>
      <p>${escapeDevelopmentRouteHtml(options.description)}</p>
      ${options.bodyHtml}
    </main>
  </body>
</html>`
}
