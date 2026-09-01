import { createAstralBeamTokenRoute } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { API_KEY } from "@/lib/config.server.ts"
import { DEMO_CHAT_TENANT, DEMO_CHAT_USER } from "@/lib/constants.server.ts"

// The factory owns the method check, the unconfigured-key 503, the 401, and no-store.
const mintDemoChatToken = createAstralBeamTokenRoute({
  apiKey: () => API_KEY,
  // A real application authenticates its own session here; the demo has one fixed user.
  tenantUser: () => ({ ...DEMO_CHAT_USER, tenant: DEMO_CHAT_TENANT }),
})

export const Route = createFileRoute("/api/chat/token")({
  server: {
    handlers: {
      POST: ({ request }) => mintDemoChatToken(request),
    },
  },
})
