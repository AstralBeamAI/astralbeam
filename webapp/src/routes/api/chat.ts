import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { openaiText } from "@tanstack/ai-openai"
import { createFileRoute } from "@tanstack/react-router"

// The SDK chat widget embeds on host origins the webapp does not serve, so the endpoint must
// answer cross-origin requests; "*" is acceptable while the endpoint is unauthenticated.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

const BASE_SYSTEM_PROMPT =
  "You are the AstralBeam assistant, embedded as a chat widget inside a host application. " +
  "Be concise and act through the declared tools. Widgets and questionnaires already render " +
  "their results in the conversation, so do not repeat their content in your replies."

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // Parses the AG-UI run input the SDK's connection sends: messages, the host-declared
        // client tools (widgets and host tools, schemas included), and forwarded props.
        const params = await chatParamsFromRequest(request)
        const { systemPrompt } = params.forwardedProps
        const abortController = new AbortController()
        const stream = chat({
          adapter: openaiText("gpt-5.6-luna"),
          messages: params.messages,
          systemPrompts: [
            BASE_SYSTEM_PROMPT,
            ...(typeof systemPrompt === "string" && systemPrompt.length > 0 ? [systemPrompt] : []),
          ],
          // No server-side tools yet: every tool executes in the host page and arrives declared
          // in the request body.
          tools: mergeAgentTools([], params.tools),
          threadId: params.threadId,
          runId: params.runId,
          parentRunId: params.parentRunId,
          resume: params.resume,
          modelOptions: { reasoning: { effort: "low" } },
          abortController,
        })
        const response = toServerSentEventsResponse(stream, { abortController })
        for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value)
        return response
      },
    },
  },
})
