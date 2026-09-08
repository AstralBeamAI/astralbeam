import { createFileRoute } from "@tanstack/react-router"
import { handleApiV1Request } from "../v1/-lib/route.server"

// Temporary compatibility for SDKs that still call /api/chat. Forward without an HTTP redirect.
export const Route = createFileRoute("/api/chat/$")({
  server: {
    handlers: {
      ANY: ({ request }) => {
        const url = new URL(request.url)
        url.pathname = url.pathname.replace("/api/chat", "/api/v1/chat").replace(/\/$/, "")
        return handleApiV1Request(new Request(url, request))
      },
    },
  },
})
