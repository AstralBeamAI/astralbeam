import { createAstralBeamOrganizationToken } from "@astralbeam/sdk/server"
import { createFileRoute } from "@tanstack/react-router"

import { API_KEY, IS_PRODUCTION, OPERATOR_EMAIL, ORGANIZATION_ID } from "@/lib/config.server.ts"

export const Route = createFileRoute("/api/astralbeam/organization-token")({
  server: {
    handlers: {
      POST: async () => {
        const headers = { "cache-control": "no-store" }
        // Fixed demo identity, never browser-supplied. Production needs host-session authorization.
        if (IS_PRODUCTION || !API_KEY || !ORGANIZATION_ID || !OPERATOR_EMAIL) {
          return Response.json({ error: "Demo organization access is not configured" }, {
            status: 503,
            headers,
          })
        }
        try {
          const token = await createAstralBeamOrganizationToken({
            apiKey: API_KEY,
            organizationId: ORGANIZATION_ID,
            email: OPERATOR_EMAIL,
          })
          return Response.json({ token }, { headers })
        } catch {
          return Response.json({ error: "Organization token could not be created" }, {
            status: 500,
            headers,
          })
        }
      },
    },
  },
})
