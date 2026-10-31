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
  const body = stream
    ? yield* Stream.fromReadableStream({
        evaluate: () => stream,
        onError: () => new RequestBodyInvalid(),
      }).pipe(
        Stream.limitBytes<RequestBodyInvalid | RequestTooLarge, never>(maximumBytes, () =>
          Stream.fail(new RequestTooLarge()),
        ),
        Stream.mkUint8Array,
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => Effect.fail(new RequestBodyInvalid()),
        }),
      )
    : new Uint8Array()
  return yield* Effect.try({
    try: (): unknown => JSON.parse(new TextDecoder().decode(body)),
    catch: () => new RequestBodyInvalid(),
  })
})
