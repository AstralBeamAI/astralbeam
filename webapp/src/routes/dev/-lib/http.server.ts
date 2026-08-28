import "@tanstack/react-start/server-only"

export function developmentResponse(
  body: string,
  contentType = "text/html; charset=utf-8",
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { "cache-control": "no-store", "content-type": contentType },
  })
}

async function headResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set("content-length", String((await response.arrayBuffer()).byteLength))
  return new Response(null, { status: response.status, headers })
}

export async function developmentNotFound(request: Request): Promise<Response> {
  const response = developmentResponse("Not Found", "text/plain; charset=utf-8", 404)
  return request.method === "HEAD" ? await headResponse(response) : response
}

export async function handleDevelopmentRequest(
  request: Request,
  getResponse: () => Promise<Response> | Response,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = developmentResponse("Method not allowed", "text/plain; charset=utf-8", 405)
    response.headers.set("allow", "GET, HEAD")
    return response
  }

  const response = await getResponse()
  return request.method === "HEAD" ? await headResponse(response) : response
}

export function developmentPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { width: min(48rem, calc(100% - 2rem)); margin: 4rem auto; }
      li { margin: 1rem 0; }
      a { text-underline-offset: 0.2em; }
    </style>
  </head>
  <body><main><h1>${title}</h1>${body}</main></body>
</html>`
}
