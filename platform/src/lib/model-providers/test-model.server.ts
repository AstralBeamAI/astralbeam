import { chat, EventType, maxIterations } from "@tanstack/ai"
import { Effect, Option, Schema } from "effect"
import { Sse } from "effect/encoding"

import { createChatAdapter, modelOutputOptions } from "@/lib/chat/adapter"
import { ModelProviderTestFailed } from "./errors.ts"
import type { ChatModelConfiguration } from "./model-providers.server.ts"

const modelTestHttpFailures: Record<number, ModelProviderTestFailed["reason"]> = {
  400: "configuration",
  401: "credentials",
  402: "allowance",
  403: "credentials",
  404: "model",
  422: "configuration",
  429: "allowance",
}

const decodeCompletedChoice = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      choices: Schema.NonEmptyArray(Schema.Struct({ finish_reason: Schema.Literal("stop") })),
    }),
  ),
)

export const testProviderModel = Effect.fn("testProviderModel")(
  function* (configuration: ChatModelConfiguration) {
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    )
    let failure: ModelProviderTestFailed | undefined
    return yield* Effect.tryPromise({
      try: async () => {
        let upstreamCompleted = false
        const guardedFetch: typeof fetch = async (request, init) => {
          failure = new ModelProviderTestFailed({ reason: "network" })
          upstreamCompleted = configuration.api !== "chat-completions"
          const response = await configuration.fetch(request, {
            ...init,
            signal: controller.signal,
          })
          if (!response.ok) {
            failure = new ModelProviderTestFailed({
              reason: modelTestHttpFailures[response.status] ?? "network",
            })
            await response.body?.cancel()
            return new Response(null, response)
          }
          failure = undefined
          let bytes = 0
          const decoder = new TextDecoder()
          // The adapter synthesizes a terminal event on EOF, even when the upstream was truncated.
          // https://github.com/TanStack/ai/blob/main/packages/openai-base/src/adapters/chat-completions-text.ts
          const parser = Sse.makeParser((event) => {
            if (event._tag === "Event" && Option.isSome(decodeCompletedChoice(event.data)))
              upstreamCompleted = true
          })
          const body = response.body?.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, stream) {
                bytes += chunk.byteLength
                if (bytes > 256 * 1024) {
                  failure = new ModelProviderTestFailed({ reason: "empty" })
                  controller.abort()
                  throw failure
                }
                if (configuration.api === "chat-completions")
                  parser.feed(decoder.decode(chunk, { stream: true }))
                stream.enqueue(chunk)
              },
            }),
          )
          return new Response(body, response)
        }
        let hasText = false
        let completed = false
        for await (const chunk of chat({
          adapter: createChatAdapter({ ...configuration, fetch: guardedFetch }),
          messages: [{ role: "user", content: "Reply with OK." }],
          agentLoopStrategy: maxIterations(1),
          modelOptions: modelOutputOptions(configuration),
          abortController: controller,
        })) {
          if (chunk.type === EventType.RUN_ERROR)
            throw failure ?? new ModelProviderTestFailed({ reason: "configuration" })
          if (chunk.type === EventType.TOOL_CALL_START)
            throw new ModelProviderTestFailed({ reason: "empty" })
          if (chunk.type === EventType.TEXT_MESSAGE_CONTENT && chunk.delta.trim()) hasText = true
          if (chunk.type === EventType.RUN_FINISHED) {
            const reason = chunk.finishReason ?? chunk.metadata?.tanstack?.finishReason
            if (chunk.outcome?.type === "interrupt" || (reason && reason !== "stop"))
              throw new ModelProviderTestFailed({ reason: "empty" })
            completed = true
          }
        }
        if (!completed || !hasText || !upstreamCompleted)
          throw failure ?? new ModelProviderTestFailed({ reason: "empty" })
      },
      catch: (cause) =>
        cause instanceof ModelProviderTestFailed
          ? cause
          : (failure ?? new ModelProviderTestFailed({ reason: "network" })),
    })
  },
  Effect.scoped,
  Effect.timeoutOrElse({
    duration: "30 seconds",
    orElse: () => Effect.fail(new ModelProviderTestFailed({ reason: "timeout" })),
  }),
)
