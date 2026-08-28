import { createFileRoute } from "@tanstack/react-router"

import {
  developmentRouteNotFoundResponse,
  handleDevelopmentRouteRequest,
} from "./-lib/http.server.ts"

async function handleDevelopmentIndexRouteRequest(request: Request): Promise<Response> {
  if (!__DEV_UTILITIES__) {
    return handleDevelopmentRouteRequest(request, developmentRouteNotFoundResponse)
  }

  const { handleDevelopmentIndexRequest } = await import("./-lib/index.server.ts")
  return handleDevelopmentIndexRequest(request)
}

export const Route = createFileRoute("/dev/")({
  server: {
    handlers: {
      GET: ({ request }) => handleDevelopmentIndexRouteRequest(request),
      HEAD: ({ request }) => handleDevelopmentIndexRouteRequest(request),
      ANY: ({ request }) => handleDevelopmentIndexRouteRequest(request),
    },
  },
})
