import { createFileRoute } from "@tanstack/react-router"

import {
  developmentRouteNotFoundResponse,
  handleDevelopmentRouteRequest,
} from "../-lib/http.server.ts"

async function handleEmailPreviewIndexRouteRequest(request: Request): Promise<Response> {
  if (!__DEV_UTILITIES__) {
    return handleDevelopmentRouteRequest(request, developmentRouteNotFoundResponse)
  }

  const { handleEmailPreviewRequest } = await import("./-lib/preview.server.ts")
  return handleEmailPreviewRequest(request)
}

export const Route = createFileRoute("/dev/emails/")({
  server: {
    handlers: {
      GET: ({ request }) => handleEmailPreviewIndexRouteRequest(request),
      HEAD: ({ request }) => handleEmailPreviewIndexRouteRequest(request),
      ANY: ({ request }) => handleEmailPreviewIndexRouteRequest(request),
    },
  },
})
