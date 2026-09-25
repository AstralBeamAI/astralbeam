export class RequestTooLargeError extends Error {}

export async function readRequestJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) throw new RequestTooLargeError()
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
        throw new RequestTooLargeError()
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
