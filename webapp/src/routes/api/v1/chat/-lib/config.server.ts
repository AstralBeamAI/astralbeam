import { createFileRoute } from "@tanstack/react-router"

import { resolveChatAgent } from "./-lib/agent.server"
import { authenticateChatRequest, isChatAuthenticationError } from "./-lib/auth.server"
import { corsHeaders, errorResponse } from "./-lib/utils.server"

/**
 * Capability handshake for the SDK widget: what the resolved agent grants, so the client can
 * render only that. Enforcement stays with the chat endpoint; the client can narrow the grant,
 * never widen it.
 */
export const Route = createFileRoute("/api/chat/config")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      GET: async ({ request }) => {
        let principal
        try {
          principal = await authenticateChatRequest(request)
        } catch (error) {
          if (isChatAuthenticationError(error)) {
            return errorResponse(request, 401, "The chat authentication token is invalid.")
          }
          console.error("Failed to authenticate /api/chat/config request:", error)
          return errorResponse(request, 500, "The request could not be authenticated.")
        }
        try {
          // Matches the chat endpoint's resolution: an explicit public ID, or the default agent.
          const agentId = new URL(request.url).searchParams.get("agentId") ?? undefined
          const selectedAgent = await resolveChatAgent(agentId, principal.organization.id)
          if (!selectedAgent) return errorResponse(request, 404, "Agent not found.")
          return Response.json(
            { capabilities: { attachments: selectedAgent.attachmentsEnabled } },
            // no-store: a stale grant would keep showing an attach button the endpoint rejects.
            { headers: { ...corsHeaders(request), "cache-control": "no-store" } },
          )
        } catch (error) {
          console.error("Failed to resolve /api/chat/config:", error)
          return errorResponse(request, 500, "The chat configuration could not be resolved.")
        }
      },
    },
  },
})
