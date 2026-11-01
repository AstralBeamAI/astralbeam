import type { ChatThreadScope } from "@/lib/chat/threads/schemas"
import {
  chatParamsFromRequestBody,
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai"
import { Cause, Duration, Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/http"

import { Chat } from "@/lib/chat/chat"
import { ChatThreads } from "@/lib/chat/threads/threads"
import { managedChatRunParams } from "@/lib/chat/threads/commands"
import {
  CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS,
  CHAT_MAX_REQUEST_BYTES,
  CHAT_MODEL_UNAVAILABLE_MESSAGE,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/chat/constants"
import type { ChatPrincipal } from "@/lib/chat/types"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { ApiUuidSchema } from "@/lib/tenants/schemas"
import { reportFailure } from "@/lib/runtime/failure-report.server"
import { readRequestJson } from "@/routes/api/-lib/request-body.server"
import { consumeRestRateLimit } from "../../-lib/auth.server"
import { chatMessageRecord, messageResource } from "./threads.server.ts"
import { ChatRunInputInvalid, ChatRunTooLarge } from "./errors.ts"

export function consumeChatRateLimit(
  principal: ChatPrincipal,
  operation: "message" | "tool-result" | "upload",
) {
  const continuation = operation === "tool-result"
  return consumeRestRateLimit(
    continuation ? "chat-continuation" : operation === "upload" ? "chat-upload" : "chat",
    [principal.organization.id, principal.tenantUser.tenant.id, principal.tenantUser.id],
    {
      limit:
        continuation || operation === "upload"
          ? CHAT_CONTINUATION_RATE_LIMIT_MAX_REQUESTS
          : CHAT_RATE_LIMIT_MAX_REQUESTS,
      window: Duration.millis(CHAT_RATE_LIMIT_WINDOW_MS),
    },
  )
}

/** Refuses a new turn or continuation before admission once an applicable usage limit is used up. */
export const checkChatUsageLimits = Effect.fn("checkChatUsageLimits")(function* (input: {
  readonly principal: ChatPrincipal
  readonly scope: ChatThreadScope
  readonly threadId: unknown
}) {
  const usageLimits = yield* UsageLimits
  const limits = yield* usageLimits.applicable({
    organizationId: input.principal.organization.id,
    listedIds: input.principal.usageLimitIds ?? [],
  })
  if (limits.length === 0) return
  // Admission rejects a malformed thread ID, so only per-conversation limits skip it here.
  const threadId = Schema.is(ApiUuidSchema)(input.threadId) ? input.threadId : undefined
  yield* usageLimits.check({ limits, subject: { ...input.scope, threadId } })
})

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
          acceptedMessage: yield* Schema.encodeEffect(chatMessageRecord)(
            messageResource(admission.inputMessage),
          ).pipe(Effect.orDie),
        },
      }),
    )
  }).pipe(
    // Invalid saved context after admission is a server failure, not a rejected new input.
    Effect.catchTag("ChatThreadInvalid", Effect.die),
    Effect.onError(() => threads.interrupt({ claim }).pipe(Effect.orDie)),
  )
})
