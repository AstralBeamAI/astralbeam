import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { openaiText } from "@tanstack/ai-openai"
import { createFileRoute } from "@tanstack/react-router"

import { BASE_SYSTEM_PROMPT } from "./-lib/constants.server"
import type { ChatParams } from "./-lib/types"
import {
  corsHeaders,
  createDebugLog,
  errorResponse,
  isRateLimited,
  stripToolCallMetadata,
  withDebugLog,
} from "./-lib/utils.server"

export const Route = createFileRoute("/api/chat/")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        if (isRateLimited(request)) {
          return errorResponse(request, 429, "Too many chat requests; try again in a minute.")
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
              forwardedProps: params.forwardedProps,
            })
            log("request", "conversation messages", params.messages)
            log("request", `client-declared tools (${params.tools.length})`, params.tools)
          }
          const abortController = new AbortController()
          const stream = chat({
            adapter: openaiText("gpt-5.6-terra"),
            messages: stripToolCallMetadata(params.messages),
            systemPrompts: [
              BASE_SYSTEM_PROMPT,
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
          // Most likely a missing OPENAI_API_KEY; the message is deliberately forwarded while the
          // endpoint is a development tool, so integrators can diagnose setup from the widget side.
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
