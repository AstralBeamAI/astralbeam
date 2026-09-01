import { CHAT_MAX_REQUEST_BYTES, CHAT_TOKEN_AUDIENCE } from "./constants.server"

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

export class ChatRequestTooLargeError extends Error {}

export async function readChatRequestJson(
  request: Request,
  maximumBytes = CHAT_MAX_REQUEST_BYTES,
): Promise<unknown> {
  if (isChatRequestTooLarge(request)) throw new ChatRequestTooLargeError()
  const reader = request.body?.getReader()
  if (!reader) return JSON.parse("") as unknown

  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ChatRequestTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}

// A 401 must advertise the scheme it wants, or a client cannot tell "no token" from "wrong token".
export function unauthorizedChatResponse(request: Request, message: string) {
  const response = errorResponse(request, 401, message)
  response.headers.set("www-authenticate", `Bearer realm="${CHAT_TOKEN_AUDIENCE}"`)
  return response
}
