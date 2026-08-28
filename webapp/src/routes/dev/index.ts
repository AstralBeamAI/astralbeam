import { createFileRoute } from "@tanstack/react-router"

import {
  developmentNotFound,
  developmentPage,
  developmentResponse,
  handleDevelopmentRequest,
} from "./-lib/http.server.ts"

function handleDevelopmentIndex(request: Request): Promise<Response> {
  if (!__DEV_SERVER__) return developmentNotFound(request)

  return handleDevelopmentRequest(request, () =>
    developmentResponse(
      developmentPage(
        "Development tools",
        '<p>Local utilities mounted during development.</p><ul><li><a href="/dev/emails">Email previews</a></li></ul>',
      ),
    ))
}

export const Route = createFileRoute("/dev/")({
  server: {
    handlers: {
      ANY: ({ request }) => handleDevelopmentIndex(request),
    },
  },
})
