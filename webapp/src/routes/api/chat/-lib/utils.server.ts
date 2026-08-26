import {
  CHAT_MAX_REQUEST_BYTES,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "./constants.server"
import type { ChatMessages } from "./types"

// The SDK chat widget embeds on host origins the webapp does not serve, so the endpoint must
// answer cross-origin requests. Bearer auth uses no cookies, so "*" remains valid; the allowed
// headers are explicit so preflights cannot expand the accepted request surface.
export function corsHeaders(_request: Request) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, last-event-id, x-run-id",
    "access-control-max-age": "86400",
  }
}

// Errors thrown out of a handler become framework responses without the CORS headers above, which
// cross-origin widgets cannot read at all; every failure must be answered as a readable response.
export function errorResponse(request: Request, status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders(request) })
}

// A declared length is only a claim, but refusing on it costs nothing and keeps an oversized
// attachment payload from being buffered and JSON-parsed at all.
export function isChatRequestTooLarge(request: Request): boolean {
  const declared = Number(request.headers.get("content-length"))
  return Number.isFinite(declared) && declared > CHAT_MAX_REQUEST_BYTES
}

const requestWindows = new Map<string, { windowStart: number; count: number }>()

export function isRateLimited(request: Request): boolean {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"
  const now = Date.now()
  const window = requestWindows.get(client)
  if (!window || now - window.windowStart >= CHAT_RATE_LIMIT_WINDOW_MS) {
    for (const [key, value] of requestWindows) {
      if (now - value.windowStart >= CHAT_RATE_LIMIT_WINDOW_MS) requestWindows.delete(key)
    }
    requestWindows.set(client, { windowStart: now, count: 1 })
    return false
  }
  window.count += 1
  return window.count > CHAT_RATE_LIMIT_MAX_REQUESTS
}

// The OpenAI adapter replays a completed tool call's Responses item id (metadata.itemId)
// on follow-up requests but not the reasoning item it was paired with, which reasoning
// models reject with a 400. Dropping the metadata replays the call by call_id alone.
export function stripToolCallMetadata(messages: ChatMessages): ChatMessages {
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
