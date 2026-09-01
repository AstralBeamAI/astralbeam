import {
  chat,
  chatParamsFromRequestBody,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { createFileRoute } from "@tanstack/react-router"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { AgentSystemPromptSchema } from "@/lib/schemas"
import { createChatAdapter } from "./-lib/adapter.server"
import { resolveChatAgent } from "./-lib/agent.server"
import { normalizeChatAttachments, redactChatAttachmentData } from "./-lib/attachments.server"
import { authenticateChatRequest, isChatAuthenticationError } from "./-lib/auth.server"
import { CHAT_SYSTEM_PROMPT } from "./-lib/constants.server"
import { createDebugLog, withDebugLog } from "./-lib/debug.server"
import { consumeChatRateLimit } from "./-lib/rate-limit.server"
import type { ChatParams } from "./-lib/types"
import {
  ChatRequestTooLargeError,
  corsHeaders,
  errorResponse,
  isChatRequestTooLarge,
  readChatRequestJson,
  unauthorizedChatResponse,
} from "./-lib/utils.server"

const isAgentSystemPrompt = Schema.is(AgentSystemPromptSchema)

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
        // Attachments ride inline in the run input, so a run can be tens of megabytes. Refused
        // from the header, before the body is read; a request without one is not pre-checked.
        if (isChatRequestTooLarge(request)) {
          return errorResponse(request, 413, "The message and its attachments are too large.")
        }
        const openaiApiKey = await getGlobalConfig("openai_api_key")
        let principal
        try {
          principal = await authenticateChatRequest(request)
        } catch (error) {
          if (isChatAuthenticationError(error)) {
            return unauthorizedChatResponse(request, "The chat authentication token is invalid.")
          }
          console.error("Failed to authenticate /api/chat request:", error)
          return errorResponse(request, 500, "The chat request could not be authenticated.")
        }
        try {
          if (await runDatabaseEffect(consumeChatRateLimit(principal))) {
            return errorResponse(request, 429, "Too many chat requests; try again in a minute.")
          }
        } catch (error) {
          console.error("Failed to enforce /api/chat rate limit:", error)
          return errorResponse(request, 500, "The chat request could not be rate limited.")
        }
        // Parses the AG-UI run input the SDK's connection sends: messages, the host-declared
        // client tools (widgets and host tools, schemas included), and forwarded props.
        let params: ChatParams
        try {
          params = await chatParamsFromRequestBody(await readChatRequestJson(request))
        } catch (error) {
          if (error instanceof ChatRequestTooLargeError) {
            return errorResponse(request, 413, "The message and its attachments are too large.")
          }
          console.error("Rejected malformed /api/chat request")
          return errorResponse(request, 400, "The request body is not a valid chat run input.")
        }
        try {
          const { agentId, systemPrompt, debug } = params.forwardedProps
          const selectedAgent = await resolveChatAgent(agentId, principal.organization.id)
          if (!selectedAgent) return errorResponse(request, 404, "Agent not found.")
          if (systemPrompt !== undefined && !isAgentSystemPrompt(systemPrompt)) {
            return errorResponse(request, 400, "The system prompt override is invalid.")
          }
          // Preserve the existing host integration override while agents establish the
          // organization-owned default used when the SDK does not supply instructions.
          const effectiveSystemPrompt = systemPrompt ?? selectedAgent.systemPrompt
          // The SDK's `debug` mount option rides along in the forwarded props, so client
          // and server log the same conversation and it can be followed from both sides.
          const log = debug === true ? createDebugLog(params.runId) : undefined
          if (log) {
            log("request", `POST /api/chat, ${params.messages.length} messages`, {
              threadId: params.threadId,
              runId: params.runId,
              parentRunId: params.parentRunId,
              resume: params.resume,
              agentId,
              debug,
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
              effectiveSystemPrompt,
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
          console.error("Failed to start /api/chat run:", error)
          return errorResponse(request, 500, "The chat run could not be started.")
        }
      },
    },
  },
})
