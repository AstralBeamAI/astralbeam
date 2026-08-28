import { createFileRoute } from "@tanstack/react-router"

import { handleDevelopmentRouteNotFoundRequest } from "./-lib/http.server.ts"

export const Route = createFileRoute("/dev/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleDevelopmentRouteNotFoundRequest(request),
      HEAD: ({ request }) => handleDevelopmentRouteNotFoundRequest(request),
      ANY: ({ request }) => handleDevelopmentRouteNotFoundRequest(request),
    },
  },
})
