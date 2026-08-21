import {
  chat,
  chatParamsFromRequest,
  mergeAgentTools,
  type StreamChunk,
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

type ChatMessages = Awaited<ReturnType<typeof chatParamsFromRequest>>["messages"]

// The OpenAI adapter replays a completed tool call's Responses item id (metadata.itemId)
// on follow-up requests but not the reasoning item it was paired with, which reasoning
// models reject with a 400. Dropping the metadata replays the call by call_id alone.
function stripToolCallMetadata(messages: ChatMessages): ChatMessages {
  return messages.map((message) => {
    if ("parts" in message && Array.isArray(message.parts)) {
      return {
        ...message,
        parts: message.parts.map((part) =>
          part.type === "tool-call" ? { ...part, metadata: undefined } : part
        ),
      }
    }
    if ("toolCalls" in message && Array.isArray(message.toolCalls)) {
      return {
        ...message,
        toolCalls: message.toolCalls.map((toolCall) => ({ ...toolCall, metadata: undefined })),
      }
    }
    return message
  })
}

const BASE_SYSTEM_PROMPT =
  "You are the AstralBeam assistant, embedded as a chat widget inside a host application. " +
  "Be concise and act through the declared tools. Widgets and questionnaires already render " +
  "their results in the conversation, so do not repeat their content in your replies."

type DebugLog = (category: string, summary: string, data?: unknown) => void

const ANSI_RESET = "\x1b[0m"
const ANSI_BADGE = "\x1b[45;97m" // magenta background, white text
const ANSI_DIM = "\x1b[2m"
const CATEGORY_ANSI: Record<string, string> = {
  request: "\x1b[36m",
  run: "\x1b[34m",
  stream: "\x1b[35m",
  text: "\x1b[32m",
  reasoning: "\x1b[90m",
  tool: "\x1b[33m",
  error: "\x1b[31m",
}

// Mirrors the SDK's browser-console debug logger so a `debug: true` conversation can be
// followed from both sides: UTC timestamp, colored category, then the full data object.
function createDebugLog(runId: string): DebugLog {
  return (category, summary, data) => {
    const color = CATEGORY_ANSI[category] ?? ""
    console.log(
      `${ANSI_BADGE} astralbeam ${ANSI_RESET} ${ANSI_DIM}${
        new Date().toISOString()
      } run=${runId}${ANSI_RESET} ${color}${category}${ANSI_RESET} ${summary}`,
    )
    if (data !== undefined) console.dir(data, { depth: null, colors: true })
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Streams are many tiny deltas; logging each would drown the terminal, so text and tool
// inputs accumulate per id and log whole on their end event. Everything else logs as-is.
async function* withDebugLog(
  stream: AsyncIterable<StreamChunk>,
  log: DebugLog,
): AsyncIterable<StreamChunk> {
  const texts = new Map<string, string>()
  const toolCalls = new Map<string, { name: string; args: string }>()
  try {
    for await (const chunk of stream) {
      const event = chunk as {
        type: string
        messageId?: string
        delta?: string
        toolCallId?: string
        toolCallName?: string
        content?: string
        message?: string
      }
      switch (event.type) {
        case "TEXT_MESSAGE_START":
        case "REASONING_MESSAGE_START":
        case "THINKING_TEXT_MESSAGE_START":
          break
        case "TEXT_MESSAGE_CONTENT":
        case "TEXT_MESSAGE_CHUNK": {
          const key = event.messageId ?? "text"
          texts.set(key, (texts.get(key) ?? "") + (event.delta ?? ""))
          break
        }
        case "TEXT_MESSAGE_END":
          log("text", texts.get(event.messageId ?? "text") ?? "", { messageId: event.messageId })
          texts.delete(event.messageId ?? "text")
          break
        case "REASONING_MESSAGE_CONTENT":
        case "REASONING_MESSAGE_CHUNK":
        case "THINKING_TEXT_MESSAGE_CONTENT": {
          const key = `reasoning:${event.messageId ?? "thinking"}`
          texts.set(key, (texts.get(key) ?? "") + (event.delta ?? ""))
          break
        }
        case "REASONING_MESSAGE_END":
        case "THINKING_TEXT_MESSAGE_END": {
          const key = `reasoning:${event.messageId ?? "thinking"}`
          log("reasoning", texts.get(key) ?? "", { messageId: event.messageId })
          texts.delete(key)
          break
        }
        case "TOOL_CALL_START":
          log("tool", `${event.toolCallName} call started`, chunk)
          toolCalls.set(event.toolCallId ?? "", { name: event.toolCallName ?? "", args: "" })
          break
        case "TOOL_CALL_ARGS": {
          const call = toolCalls.get(event.toolCallId ?? "")
          if (call) call.args += event.delta ?? ""
          break
        }
        case "TOOL_CALL_END": {
          const call = toolCalls.get(event.toolCallId ?? "")
          toolCalls.delete(event.toolCallId ?? "")
          log("tool", `${call?.name ?? "tool"} input complete`, {
            toolCallId: event.toolCallId,
            input: parseJson(call?.args ?? ""),
          })
          break
        }
        case "TOOL_CALL_RESULT":
          log("tool", `result for tool call ${event.toolCallId}`, {
            toolCallId: event.toolCallId,
            content: parseJson(event.content ?? ""),
          })
          break
        case "RUN_STARTED":
          log("run", "run started", chunk)
          break
        case "RUN_FINISHED":
          log("run", "run finished", chunk)
          break
        case "RUN_ERROR":
          log("error", `run failed: ${event.message}`, chunk)
          break
        default:
          log("stream", event.type, chunk)
      }
      yield chunk
    }
    log("run", "stream closed")
  } catch (error) {
    log("error", "stream threw", error)
    throw error
  }
}

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
            adapter: openaiText("gpt-5.6-luna"),
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
            modelOptions: { reasoning: { effort: "low" } },
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
