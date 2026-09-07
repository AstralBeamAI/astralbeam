import { createChatAuthToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { API_KEY } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

// A cached token would outlive its short expiry, so every answer carries no-store.
function tokenResponse(body: Record<string, string>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async () => {
        if (!API_KEY) {
          return tokenResponse({ error: "The AstralBeam API key is not configured" }, 503)
        }
        // A real application authenticates its own session here and answers 401 without one;
        // the demo mints for one fixed user instead.
        try {
          const token = await createChatAuthToken({
            apiKey: API_KEY,
            user: DEMO_CHAT_USER,
            tenant: DEMO_CHAT_TENANT,
          })
          return tokenResponse({ token }, 200)
        } catch {
          // The thrown message can describe the API key's shape; never send it to a client.
          return tokenResponse({ error: "The chat auth token could not be created" }, 500)
        }
      },
    },
  },
})
