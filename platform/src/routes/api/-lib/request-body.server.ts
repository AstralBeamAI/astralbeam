import { Effect, Schema, Stream } from "effect"

class RequestTooLarge extends Schema.TaggedError<RequestTooLarge>()("RequestTooLarge", {}) {}

class RequestBodyInvalid extends Schema.TaggedError<RequestBodyInvalid>()(
  "RequestBodyInvalid",
  {},
) {}

/** Reads a JSON body, refusing one over `maximumBytes` as declared and again while it streams. */
export const readRequestJson = Effect.fn("readRequestJson")(function* (
  request: Request,
  maximumBytes: number,
) {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maximumBytes) return yield* new RequestTooLarge()
  const { body: stream } = request
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (stream) {
    yield* Stream.fromReadableStream({
      evaluate: () => stream,
      onError: () => new RequestBodyInvalid(),
    }).pipe(
      Stream.runForEach((chunk) => {
        byteLength += chunk.byteLength
        if (byteLength > maximumBytes) return Effect.fail(new RequestTooLarge())
        chunks.push(chunk)
        return Effect.void
      }),
    )
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(body)),
    catch: () => new RequestBodyInvalid(),
  })
})
