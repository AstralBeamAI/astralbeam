import { createFileRoute } from "@tanstack/react-router"

import { getAuth } from "@/lib/auth.server"
import { setupGateResponse } from "@/lib/config.server"

async function handleAuthRequest(request: Request): Promise<Response> {
  const gate = await setupGateResponse()
  if (gate) return gate
  return (await getAuth()).handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})
