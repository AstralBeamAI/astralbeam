import {
  type AnyServerTool,
  chat,
  chatParamsFromRequestBody,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { createFileRoute } from "@tanstack/react-router"

import { runDatabaseEffect } from "@/db"
import { createChatAdapter } from "./-lib/adapter.server"
import { resolveChatAgent } from "./-lib/agent.server"
import { normalizeChatAttachments, redactChatAttachmentData } from "./-lib/attachments.server"
import { authenticateChatRequest, isChatAuthenticationError } from "./-lib/auth.server"
import {
  CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT,
  CHAT_SANDBOX_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from "./-lib/constants.server"
import { createDebugLog, withDebugLog } from "./-lib/debug.server"
import { consumeChatRateLimit } from "./-lib/rate-limit.server"
import { resolveChatSandboxSession } from "./-lib/sandbox.server"
import { createChatSandboxTools } from "./-lib/sandbox-tools.server"
import type { ChatParams } from "./-lib/types"
import {
  ChatRequestTooLargeError,
  corsHeaders,
  errorResponse,
  isChatRequestTooLarge,
  readChatRequestJson,
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
          if (!selectedAgent) {
            return errorResponse(
              request,
              404,
              agentId === undefined || agentId === null
                ? "This organization has no default agent; pass an agentId or set a default."
                : "Agent not found.",
            )
          }
          // Instructions are agent configuration: a browser-supplied prompt would let any tenant
          // user rewrite them from devtools, so the endpoint refuses rather than ignores it.
          if (systemPrompt !== undefined && systemPrompt !== null) {
            return errorResponse(
              request,
              400,
              "The system prompt is agent configuration; set it in the dashboard.",
            )
          }
          const effectiveSystemPrompt = selectedAgent.systemPrompt
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
          // Agent capability policy, enforced here regardless of what the client narrowed.
          if (!selectedAgent.attachmentsEnabled && attachments.length > 0) {
            return errorResponse(request, 400, "This agent does not accept file attachments.")
          }
          if (log && attachments.length > 0) {
            log("attachment", `${attachments.length} attachment(s) normalized`, attachments)
          }
          // The agent's sandbox, when it has one. Resolving it is one database read and builds no
          // sandbox: the tools provision one only if the agent actually reaches for them.
          let sandboxTools: AnyServerTool[] = []
          if (selectedAgent.sandboxProviderId) {
            try {
              const session = await runDatabaseEffect(resolveChatSandboxSession({
                sandboxProviderId: selectedAgent.sandboxProviderId,
                agentId: selectedAgent.id,
                principal,
                threadId: params.threadId,
                runId: params.runId,
              }))
              sandboxTools = createChatSandboxTools({
                session,
                log,
                artifactScope: {
                  organizationId: principal.organization.id,
                  tenantUserId: principal.tenantUser.id,
                  sandboxProviderId: selectedAgent.sandboxProviderId,
                },
              })
              log?.("sandbox", `${sandboxTools.length} sandbox tools declared`)
            } catch (error) {
              // Degrade rather than refuse the reply: an unreadable provider configuration is the
              // organization's problem and the agent is still useful without a sandbox. Its tools
              // and its prompt drop together, so it never offers a capability it does not have.
              console.error("Failed to prepare the /api/chat sandbox:", error)
            }
          }
          const abortController = new AbortController()
          const stream = chat({
            adapter: createChatAdapter(openaiApiKey),
            messages,
            systemPrompts: [
              CHAT_SYSTEM_PROMPT,
              ...(sandboxTools.length > 0
                ? [CHAT_SANDBOX_SYSTEM_PROMPT, CHAT_SANDBOX_ARTIFACT_SYSTEM_PROMPT]
                : []),
              effectiveSystemPrompt,
            ],
            // Every other tool executes in the host page and arrives declared in the request body;
            // a client tool reusing a sandbox tool's name is dropped by `mergeAgentTools`.
            tools: mergeAgentTools(sandboxTools, params.tools),
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
