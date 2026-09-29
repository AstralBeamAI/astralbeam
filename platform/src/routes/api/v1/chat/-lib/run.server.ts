import {
  chatParamsFromRequestBody,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"

import { CHAT_MAX_REQUEST_BYTES } from "@/lib/chat/constants.server"
import { readRequestJson, RequestTooLargeError } from "@/routes/api/-lib/request-body.server"
import { restFault } from "../../-lib/responses.server"

/** Reads the AG-UI run input through the bounded body reader and TanStack's own parser. */
export const readChatRunParams = Effect.fn("readChatRunParams")(function* (request: Request) {
  const body = yield* Effect.tryPromise({
    try: () => readRequestJson(request, CHAT_MAX_REQUEST_BYTES),
    catch: (error) =>
      error instanceof RequestTooLargeError
        ? restFault(413, "The message and its attachments are too large.")
        : restFault(400, "The request body is not a valid chat run input."),
  })
  return yield* Effect.tryPromise({
    try: () => chatParamsFromRequestBody(body),
    catch: () => restFault(400, "The request body is not a valid chat run input."),
  })
})

/**
 * Streams a run as Server-Sent Events without buffering. TanStack encodes the events, so the AG-UI
 * wire stays its own, and cancelling the response body interrupts the run's stream.
 */
export function chatRunResponse(events: Stream.Stream<StreamChunk>) {
  return Effect.map(Stream.toAsyncIterableEffect(events), (iterable) =>
    HttpServerResponse.fromWeb(toServerSentEventsResponse(iterable)),
  )
}
