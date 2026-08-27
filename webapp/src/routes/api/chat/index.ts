import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { createFileRoute } from "@tanstack/react-router"

import { createChatAdapter } from "./-lib/adapter.server"
import { normalizeChatAttachments, redactChatAttachmentData } from "./-lib/attachments.server"
import {
  authenticateChatRequest,
  isChatAuthenticationConfigurationError,
  isChatAuthenticationError,
} from "./-lib/auth.server"
import { CHAT_SYSTEM_PROMPT } from "./-lib/constants.server"
import { createDebugLog, withDebugLog } from "./-lib/debug.server"
import type { ChatParams } from "./-lib/types"
import {
  corsHeaders,
  errorResponse,
  isChatRequestTooLarge,
  isRateLimited,
  unauthorizedChatResponse,
} from "./-lib/utils.server"

export const Route = createFileRoute("/api/chat/")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const { getDatabaseBootstrapIssues } = await import(
          "@/db/lib/database-credentials.server"
        )
        if (getDatabaseBootstrapIssues().length > 0) {
          return errorResponse(request, 503, "Server configuration required.")
        }
        const [{ getGlobalConfig }, { setupGateResponse }] = await Promise.all([
          import("@/lib/config"),
          import("@/lib/config/state.server"),
        ])
        const gate = await setupGateResponse()
        if (gate) return gate
        if (isRateLimited(request)) {
          return errorResponse(request, 429, "Too many chat requests; try again in a minute.")
        }
        // Attachments ride inline in the run input, so a run can be tens of megabytes. Refused
        // from the header, before the body is read; a request without one is not pre-checked.
        if (isChatRequestTooLarge(request)) {
          return errorResponse(request, 413, "The message and its attachments are too large.")
        }
        const [chatAuthSecret, openaiApiKey] = await Promise.all([
          getGlobalConfig("chat_auth_secret"),
          getGlobalConfig("openai_api_key"),
        ])
        let principal
        try {
          principal = await authenticateChatRequest(request, chatAuthSecret ?? undefined)
        } catch (error) {
          if (isChatAuthenticationConfigurationError(error)) {
            console.error("Authenticated /api/chat request rejected: verifier is not configured")
            return errorResponse(request, 503, "Chat authentication is temporarily unavailable.")
          }
          if (isChatAuthenticationError(error)) {
            return unauthorizedChatResponse(request, "The chat authentication token is invalid.")
          }
          console.error("Failed to authenticate /api/chat request:", error)
          return errorResponse(request, 500, "The chat request could not be authenticated.")
        }
        // Guest chat is off for now: a run costs provider tokens, attachments especially, so
        // every request must carry a token minted by a host application for a signed-in user.
        if (principal.kind !== "authenticated") {
          return unauthorizedChatResponse(request, "This chat endpoint requires a signed-in user.")
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
              user: principal.user.id,
              tenant: principal.tenant.id,
              forwardedProps: params.forwardedProps,
            })
            log("request", "conversation messages", redactChatAttachmentData(params.messages))
            log("request", `client-declared tools (${params.tools.length})`, params.tools)
          }
          if (!openaiApiKey) {
            return errorResponse(request, 503, "Chat is not configured.")
          }
          // Attachments are rewritten into what the model reads before the run starts: the
          // provider adapter throws on a content part it cannot map, which would fail the whole
          // run over one unsupported file.
          const { messages, attachments } = normalizeChatAttachments(params.messages)
          if (log && attachments.length > 0) {
            log("attachment", `${attachments.length} attachment(s) normalized`, attachments)
          }
          const abortController = new AbortController()
          const stream = chat({
            adapter: createChatAdapter(openaiApiKey),
            messages,
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
