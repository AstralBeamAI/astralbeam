import {
  chatParamsFromRequestBody,
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { Cause, Duration, Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/http"

import { Chat } from "@/lib/chat/chat.server"
import { ChatThreads } from "@/lib/chat/threads/threads.server"
import { managedChatRunParams } from "@/lib/chat/threads/commands.server"
import {
  CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS,
  CHAT_MAX_REQUEST_BYTES,
  CHAT_MODEL_UNAVAILABLE_MESSAGE,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/chat/constants.server"
import type { ChatPrincipal } from "@/lib/chat/types"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { readRequestJson } from "@/routes/api/-lib/request-body.server"
import { consumeRestRateLimit } from "../../-lib/auth.server"
import { ChatRunInputInvalid, ChatRunTooLarge } from "./errors.ts"

export function consumeChatRateLimit(
  principal: ChatPrincipal,
  operation: "message" | "tool-result",
) {
  const continuation = operation === "tool-result"
  return consumeRestRateLimit(
    continuation ? "chat-continuation" : "chat",
    [principal.organization.id, principal.tenantUser.tenant.id, principal.tenantUser.id],
    {
      limit: continuation
        ? CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS
        : CHAT_RATE_LIMIT_MAX_REQUESTS,
      window: Duration.millis(CHAT_RATE_LIMIT_WINDOW_MS),
    },
  )
}

export const readChatRequestBody = Effect.fn("readChatRequestBody")((request: Request) =>
  readRequestJson(request, CHAT_MAX_REQUEST_BYTES).pipe(
    Effect.catchTags({
      RequestTooLarge: () => Effect.fail(new ChatRunTooLarge()),
      RequestBodyInvalid: () => Effect.fail(new ChatRunInputInvalid()),
    }),
  ),
)

/** Reads the AG-UI run input through the bounded body reader and TanStack's own parser. */
export const readChatRunParams = Effect.fn("readChatRunParams")(function* (request: Request) {
  const body = yield* readChatRequestBody(request)
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
  const safeEvents = events.pipe(
    Stream.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Stream.failCause(cause)
        : Stream.fromEffect(
            reportFailure("chatRunResponse", cause).pipe(
              Effect.as<StreamChunk>({
                type: EventType.RUN_ERROR,
                message: CHAT_MODEL_UNAVAILABLE_MESSAGE,
              }),
            ),
          ),
    ),
  )
  return Effect.map(Stream.toAsyncIterableEffect(safeEvents), (iterable) =>
    HttpServerResponse.fromWeb(toServerSentEventsResponse(iterable)),
  )
}

export const chatAdmissionResponse = Effect.fn("chatAdmissionResponse")(function* (
  input: Parameters<typeof managedChatRunParams>[0] & {
    principal: ChatPrincipal
    clientId: string
  },
) {
  const chat = yield* Chat
  const threads = yield* ChatThreads
  const { admission, principal, clientId } = input
  const claim = admission.claim!
  return yield* Effect.gen(function* () {
    const params = yield* managedChatRunParams(input)
    return yield* chatRunResponse(
      yield* chat.run({
        params,
        principal,
        managed: {
          claim,
          clientId,
          threadVersion: admission.thread.lockVersion,
          acceptedMessageId: admission.inputMessage.id,
        },
      }),
    )
  }).pipe(Effect.onError(() => threads.interrupt({ claim }).pipe(Effect.orDie)))
})
