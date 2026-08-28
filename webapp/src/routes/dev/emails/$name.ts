import { createFileRoute } from "@tanstack/react-router"

import {
  developmentRouteNotFoundResponse,
  handleDevelopmentRouteRequest,
} from "../-lib/http.server.ts"

async function handleNamedEmailPreviewRouteRequest(
  request: Request,
  name: string,
): Promise<Response> {
  if (!__DEV_UTILITIES__) {
    return handleDevelopmentRouteRequest(request, developmentRouteNotFoundResponse)
  }

  const { handleEmailPreviewRequest } = await import("./-lib/preview.server.ts")
  return handleEmailPreviewRequest(request, name)
}

export const Route = createFileRoute("/dev/emails/$name")({
  server: {
    handlers: {
      GET: ({ params, request }) => handleNamedEmailPreviewRouteRequest(request, params.name),
      HEAD: ({ params, request }) => handleNamedEmailPreviewRouteRequest(request, params.name),
      ANY: ({ params, request }) => handleNamedEmailPreviewRouteRequest(request, params.name),
    },
  },
})
