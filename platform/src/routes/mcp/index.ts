import { createFileRoute } from "@tanstack/react-router"

import { handleApiV1Request } from "@/routes/api/v1/-lib/route.server"

export const Route = createFileRoute("/mcp/")({
  server: {
    handlers: {
      ANY: ({ request }) => handleApiV1Request(request),
    },
  },
})
