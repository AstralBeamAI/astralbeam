import { CHAT_MAX_REQUEST_BYTES } from "@/lib/chat/constants.server"

export class ChatRequestTooLargeError extends Error {}

export async function readChatRequestJson(
  request: Request,
  maximumBytes = CHAT_MAX_REQUEST_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) throw new ChatRequestTooLargeError()
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
