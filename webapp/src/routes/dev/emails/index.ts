import { createFileRoute } from "@tanstack/react-router"

import { developmentNotFound } from "../-lib/http.server.ts"

async function handleEmailPreviewIndexRouteRequest(request: Request): Promise<Response> {
  if (!__DEV_SERVER__) {
    return developmentNotFound(request)
  }

  const { handleEmailPreviewRequest } = await import("./-lib/preview.server.ts")
  return handleEmailPreviewRequest(request)
}

export const Route = createFileRoute("/dev/emails/")({
  server: {
    handlers: {
      ANY: ({ request }) => handleEmailPreviewIndexRouteRequest(request),
    },
  },
})
