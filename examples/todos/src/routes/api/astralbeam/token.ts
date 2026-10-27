import { createAstralBeamToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"
import { API_KEY, IS_PRODUCTION } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

const headers = { "Cache-Control": "no-store" }

export const Route = createFileRoute("/api/astralbeam/token")({
  server: {
    handlers: {
      POST: async () => {
        if (IS_PRODUCTION || !API_KEY) {
          return Response.json(
            { error: "The demo token endpoint is unavailable" },
            { status: 503, headers },
          )
        }
        try {
          const token = await createAstralBeamToken({
            apiKey: API_KEY,
            user: DEMO_CHAT_USER,
            tenant: DEMO_CHAT_TENANT,
          })
          return Response.json({ token }, { headers })
        } catch {
          return Response.json(
            { error: "The chat token could not be created" },
            { status: 500, headers },
          )
        }
      },
    },
  },
})
