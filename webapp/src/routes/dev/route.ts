import { createFileRoute } from "@tanstack/react-router"

import { developmentOnlyRouteMiddleware } from "./-lib/http.server.ts"

export const Route = createFileRoute("/dev")({
  server: {
    middleware: [developmentOnlyRouteMiddleware],
  },
})
