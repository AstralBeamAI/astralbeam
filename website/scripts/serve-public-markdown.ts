import { readFileSync } from "node:fs"
import type { Connect } from "vite"

/** Native Nitro serving uses an octet-stream MIME type for Markdown in dev and preview.
 * https://github.com/nitrojs/nitro/blob/main/src/dev/app.ts */
export function servePublicMarkdown(directory: URL): Connect.NextHandleFunction {
  return (request, response, next) => {
    const pathname = request.url?.split("?")[0]
    if (
      (request.method !== "GET" && request.method !== "HEAD") ||
      (pathname !== "/auth.md" && pathname !== "/agents.md")
    )
      return next()
    const content = readFileSync(new URL(pathname.slice(1), directory))
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "inline",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    })
    response.end(request.method === "HEAD" ? undefined : content)
  }
}
