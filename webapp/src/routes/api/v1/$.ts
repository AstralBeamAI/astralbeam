import { createFileRoute } from "@tanstack/react-router"
import { handleApiV1Request } from "./-lib/route.server"

export const Route = createFileRoute("/api/v1/$")({
  server: { handlers: { ANY: ({ request }) => handleApiV1Request(request) } },
})
