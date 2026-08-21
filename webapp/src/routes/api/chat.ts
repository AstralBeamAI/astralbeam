import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { openaiText } from "@tanstack/ai-openai"
import { createFileRoute } from "@tanstack/react-router"

// The SDK chat widget embeds on host origins the webapp does not serve, so the endpoint must
// answer cross-origin requests; "*" is acceptable while the endpoint is unauthenticated. The
// client's connection adds headers beyond content-type (x-run-id per request, last-event-id on
// stream reconnects), so the preflight echoes whatever headers the browser asks to send.
function corsHeaders(request: Request) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": request.headers.get("access-control-request-headers") ??
      "content-type",
    "access-control-max-age": "86400",
  }
}

// Errors thrown out of a handler become framework responses without the CORS headers above, which
// cross-origin widgets cannot read at all; every failure must be answered as a readable response.
function errorResponse(request: Request, status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders(request) })
}

// Interim per-instance abuse guard while the endpoint is unauthenticated: a fixed one-minute
// request window per client address, held in memory.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 20
const requestWindows = new Map<string, { windowStart: number; count: number }>()

function isRateLimited(request: Request): boolean {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  const now = Date.now()
  const window = requestWindows.get(client)
  if (!window || now - window.windowStart >= RATE_LIMIT_WINDOW_MS) {
    for (const [key, value] of requestWindows) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) requestWindows.delete(key)
    }
    requestWindows.set(client, { windowStart: now, count: 1 })
    return false
  }
  window.count += 1
  return window.count > RATE_LIMIT_MAX_REQUESTS
}

const BASE_SYSTEM_PROMPT =
  "You are the AstralBeam assistant, embedded as a chat widget inside a host application. " +
  "Be concise and act through the declared tools. Widgets and questionnaires already render " +
  "their results in the conversation, so do not repeat their content in your replies."

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        if (isRateLimited(request)) {
          return errorResponse(request, 429, "Too many chat requests; try again in a minute.")
        }
        // Parses the AG-UI run input the SDK's connection sends: messages, the host-declared
        // client tools (widgets and host tools, schemas included), and forwarded props.
        let params: Awaited<ReturnType<typeof chatParamsFromRequest>>
        try {
          params = await chatParamsFromRequest(request)
        } catch (error) {
          console.error("Rejected malformed /api/chat request:", error)
          return errorResponse(request, 400, "The request body is not a valid chat run input.")
        }
        try {
          const { systemPrompt } = params.forwardedProps
          const abortController = new AbortController()
          const stream = chat({
            adapter: openaiText("gpt-5.6-luna"),
            messages: params.messages,
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
            modelOptions: { reasoning: { effort: "low" } },
            abortController,
          })
          const response = toServerSentEventsResponse(stream, { abortController })
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
