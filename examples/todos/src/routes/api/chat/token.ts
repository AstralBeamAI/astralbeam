import { createAstralBeamChatToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { CHAT_AUTH_SECRET, CHAT_AUTH_SECRET_ENV } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

export const Route = createFileRoute("/api/chat/token")({
  server: {
    handlers: {
      POST: async () => {
        if (!CHAT_AUTH_SECRET) {
          return Response.json(
            { error: `${CHAT_AUTH_SECRET_ENV} is not configured` },
            { status: 503, headers: { "cache-control": "no-store" } },
          )
        }

        try {
          const token = await createAstralBeamChatToken({
            secret: CHAT_AUTH_SECRET,
            user: DEMO_CHAT_USER,
            tenant: DEMO_CHAT_TENANT,
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
