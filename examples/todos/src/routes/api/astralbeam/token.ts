import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { API_KEY, IS_PRODUCTION } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

// A cached token would outlive its short expiry, so every answer carries no-store.
function tokenResponse(body: Record<string, string>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async () => {
        // This route hands the fixed demo identity to any caller, so it never runs in production.
        if (IS_PRODUCTION) {
          return tokenResponse({ error: "The demo token route is disabled in production" }, 503)
        }
        if (!API_KEY) {
          return tokenResponse({ error: "The AstralBeam API key is not configured" }, 503)
        }
        // A real application authenticates its own session here and answers 401 without one;
        // the demo mints for one fixed user instead.
        try {
          const token = await createAstralBeamToken({
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
