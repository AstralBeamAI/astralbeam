import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { createOpenaiChat } from "@tanstack/ai-openai"
import { createFileRoute } from "@tanstack/react-router"

import { getConfig, setupGateResponse } from "@/lib/config.server"
import {
  authenticateChatRequest,
  isChatAuthenticationConfigurationError,
  isChatAuthenticationError,
} from "./-lib/auth.server"
import { CHAT_SYSTEM_PROMPT, CHAT_TOKEN_AUDIENCE } from "./-lib/constants.server"
import { createDebugLog, withDebugLog } from "./-lib/debug.server"
import type { ChatParams } from "./-lib/types"
import {
  corsHeaders,
  errorResponse,
  isRateLimited,
  stripToolCallMetadata,
} from "./-lib/utils.server"

export const Route = createFileRoute("/api/chat/")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const gate = await setupGateResponse()
        if (gate) return gate
        if (isRateLimited(request)) {
          return errorResponse(request, 429, "Too many chat requests; try again in a minute.")
        }
        const { chatAuthSecret, openaiApiKey } = await getConfig()
        let principal
        try {
          principal = await authenticateChatRequest(request, chatAuthSecret ?? undefined)
        } catch (error) {
          if (isChatAuthenticationConfigurationError(error)) {
            console.error("Authenticated /api/chat request rejected: verifier is not configured")
            return errorResponse(request, 503, "Chat authentication is temporarily unavailable.")
          }
          if (isChatAuthenticationError(error)) {
            const response = errorResponse(
              request,
              401,
              "The chat authentication token is invalid.",
            )
            response.headers.set("www-authenticate", `Bearer realm="${CHAT_TOKEN_AUDIENCE}"`)
            return response
          }
          console.error("Failed to authenticate /api/chat request:", error)
          return errorResponse(request, 500, "The chat request could not be authenticated.")
        }
        // Parses the AG-UI run input the SDK's connection sends: messages, the host-declared
        // client tools (widgets and host tools, schemas included), and forwarded props.
        let params: ChatParams
        try {
          params = await chatParamsFromRequest(request)
        } catch (error) {
          console.error("Rejected malformed /api/chat request:", error)
          return errorResponse(request, 400, "The request body is not a valid chat run input.")
        }
        try {
          const { systemPrompt, debug } = params.forwardedProps
          // The SDK's `debug` mount option rides along in the forwarded props, so client
          // and server log the same conversation and it can be followed from both sides.
          const log = debug === true ? createDebugLog(params.runId) : undefined
          if (log) {
            log("request", `POST /api/chat, ${params.messages.length} messages`, {
              threadId: params.threadId,
              runId: params.runId,
              parentRunId: params.parentRunId,
              resume: params.resume,
              authenticated: principal.kind === "authenticated",
              forwardedProps: params.forwardedProps,
            })
            log("request", "conversation messages", params.messages)
            log("request", `client-declared tools (${params.tools.length})`, params.tools)
          }
          if (!openaiApiKey) {
            return errorResponse(request, 503, "Chat is not configured.")
          }
          const abortController = new AbortController()
          const stream = chat({
            adapter: createOpenaiChat("gpt-5.6-terra", openaiApiKey),
            messages: stripToolCallMetadata(params.messages),
            systemPrompts: [
              CHAT_SYSTEM_PROMPT,
              ...(typeof systemPrompt === "string" && systemPrompt.length > 0
                ? [systemPrompt]
                : []),
            ],
            // No server-side tools yet: every tool executes in the host page and arrives declared
            // in the request body.
            tools: mergeAgentTools([], params.tools),
            threadId: params.threadId,
            runId: params.runId,
            parentRunId: params.parentRunId,
            resume: params.resume,
            modelOptions: { reasoning: { effort: "high" } },
            abortController,
          })
          const response = toServerSentEventsResponse(
            log ? withDebugLog(stream, log) : stream,
            { abortController },
          )
          for (const [name, value] of Object.entries(corsHeaders(request))) {
            response.headers.set(name, value)
          }
          return response
        } catch (error) {
          // The message is deliberately forwarded while the endpoint is a development tool, so
          // integrators can diagnose setup from the widget side.
          console.error("Failed to start /api/chat run:", error)
          return errorResponse(
            request,
            500,
            error instanceof Error ? error.message : "The chat run could not be started.",
          )
        }
      },
    },
  },
})
