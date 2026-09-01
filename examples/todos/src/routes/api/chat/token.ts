import { createAstralBeamChatToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { API_KEY, API_KEY_ENV } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

export const Route = createFileRoute("/api/chat/token")({
  server: {
    handlers: {
      POST: async () => {
        if (!API_KEY) {
          return Response.json(
            { error: `${API_KEY_ENV} must be configured` },
            { status: 503, headers: { "cache-control": "no-store" } },
          )
        }

        try {
          const token = await createAstralBeamChatToken({
            apiKey: API_KEY,
            tenantUser: { ...DEMO_CHAT_USER, tenant: DEMO_CHAT_TENANT },
          })
          return Response.json({ token }, { headers: { "cache-control": "no-store" } })
        } catch (error) {
          console.error("Failed to mint the todos example chat token", error)
          return Response.json(
            { error: "Unable to authenticate chat" },
            { status: 500, headers: { "cache-control": "no-store" } },
          )
        }
      },
    },
  },
})
