import { createFileRoute } from "@tanstack/react-router"

import { developmentNotFound } from "../-lib/http.server.ts"

async function handleNamedEmailPreviewRouteRequest(
  request: Request,
  name: string,
): Promise<Response> {
  if (!__DEV_SERVER__) {
    return developmentNotFound(request)
  }

  const { handleEmailPreviewRequest } = await import("./-lib/preview.server.ts")
  return handleEmailPreviewRequest(request, name)
}

export const Route = createFileRoute("/dev/emails/$name")({
  server: {
    handlers: {
      ANY: ({ params, request }) => handleNamedEmailPreviewRouteRequest(request, params.name),
    },
  },
})
