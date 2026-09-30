import {
  chatParamsFromRequestBody,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { Duration, Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/http"

import {
  CHAT_MAX_REQUEST_BYTES,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/chat/constants.server"
import type { ChatPrincipal } from "@/lib/chat/types"
import { readRequestJson } from "@/routes/api/-lib/request-body.server"
import { consumeRestRateLimit } from "../../-lib/auth.server"
import { ChatRunInputInvalid, ChatRunTooLarge } from "./errors.ts"

/**
 * Chat's own bucket, keyed by all three of organization, tenant, and tenant-user id, and
 * independent of Better Auth API-key usage, which a chat run never consumes.
 */
export function consumeChatRateLimit(principal: ChatPrincipal) {
  return consumeRestRateLimit(
    "chat",
    [principal.organization.id, principal.tenantUser.tenant.id, principal.tenantUser.id],
    { limit: CHAT_RATE_LIMIT_MAX_REQUESTS, window: Duration.millis(CHAT_RATE_LIMIT_WINDOW_MS) },
  )
}

/** Reads the AG-UI run input through the bounded body reader and TanStack's own parser. */
export const readChatRunParams = Effect.fn("readChatRunParams")(function* (request: Request) {
  const body = yield* readRequestJson(request, CHAT_MAX_REQUEST_BYTES).pipe(
    Effect.catchTags({
      RequestTooLarge: () => Effect.fail(new ChatRunTooLarge()),
      RequestBodyInvalid: () => Effect.fail(new ChatRunInputInvalid()),
    }),
  )
  return yield* Effect.tryPromise({
    try: () => chatParamsFromRequestBody(body),
    catch: () => new ChatRunInputInvalid(),
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
