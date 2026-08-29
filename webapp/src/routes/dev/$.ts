import { createFileRoute } from "@tanstack/react-router"

const DEVELOPMENT_INDEX = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Development tools</title>
<h1>Development tools</h1>
<p>Local utilities mounted during development.</p>
<ul><li><a href="/dev/emails">Email previews</a></li></ul>`

export const Route = createFileRoute("/dev/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!import.meta.env.DEV) return new Response("Not Found", { status: 404 })

        const path = params._splat?.replace(/\/+$/, "") ?? ""
        if (!path) {
          return new Response(DEVELOPMENT_INDEX, {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        }

        const emailPath = /^emails(?:\/([^/]+))?$/.exec(path)
        if (!emailPath) return new Response("Not Found", { status: 404 })

        const { handleEmailPreviewRequest } = await import("@/emails/preview.server.ts")
        return handleEmailPreviewRequest(request, emailPath[1])
      },
      ANY: () => {
        if (!import.meta.env.DEV) return new Response("Not Found", { status: 404 })
        return new Response("Method Not Allowed", { status: 405 })
      },
    },
  },
})
