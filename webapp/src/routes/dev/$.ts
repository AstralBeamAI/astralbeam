import { createFileRoute } from "@tanstack/react-router"

import { developmentNotFound } from "./-lib/http.server.ts"

export const Route = createFileRoute("/dev/$")({
  server: {
    handlers: {
      ANY: ({ request }) => developmentNotFound(request),
    },
  },
})
