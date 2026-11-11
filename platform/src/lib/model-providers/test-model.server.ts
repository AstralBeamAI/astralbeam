import { EventType, maxIterations } from "@tanstack/ai"
import { chat } from "@tanstack/ai-effect"
import { Effect, Stream } from "effect"

import { chatModelOutputOptions, createChatAdapter } from "@/lib/chat/adapter"
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

export const testProviderModel = Effect.fn("testProviderModel")(
  function* (configuration: ChatModelConfiguration) {
    let failure: ModelProviderTestFailed | undefined
    const guardedFetch: ChatModelConfiguration["fetch"] = async (request, init) => {
      failure = new ModelProviderTestFailed({ reason: "network" })
      const response = await configuration.fetch(request, init)
      if (!response.ok) {
        failure = new ModelProviderTestFailed({
          reason: modelTestHttpFailures[response.status] ?? "network",
        })
        await response.body?.cancel()
        return new Response(null, response)
      }
      failure = undefined
      let bytes = 0
      const body = response.body?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, stream) {
            bytes += chunk.byteLength
            if (bytes > 256 * 1024) {
              failure = new ModelProviderTestFailed({ reason: "empty" })
              throw failure
            }
            stream.enqueue(chunk)
          },
        }),
      )
      return new Response(body, response)
    }
    let hasText = false
    let completed = false
    yield* chat({
      debug: false,
      threadId: crypto.randomUUID(),
      adapter: createChatAdapter({ ...configuration, fetch: guardedFetch }),
      messages: [{ role: "user", content: "Reply with OK." }],
      agentLoopStrategy: maxIterations(1),
      modelOptions: chatModelOutputOptions(configuration, 1024),
    }).pipe(
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          if (chunk.type === EventType.RUN_ERROR)
            return Effect.fail(
              failure ??
                new ModelProviderTestFailed({
                  reason: chunk.code === "incomplete-stream" ? "empty" : "configuration",
                }),
            )
          if (chunk.type === EventType.TOOL_CALL_START)
            return Effect.fail(new ModelProviderTestFailed({ reason: "empty" }))
          if (chunk.type === EventType.TEXT_MESSAGE_CONTENT && chunk.delta.trim()) hasText = true
          if (chunk.type === EventType.RUN_FINISHED) {
            const reason = chunk.finishReason ?? chunk.metadata?.tanstack?.finishReason
            if (chunk.outcome?.type === "interrupt" || (reason && reason !== "stop"))
              return Effect.fail(new ModelProviderTestFailed({ reason: "empty" }))
            completed = true
          }
          return Effect.void
        }),
      ),
      Effect.mapError((error) =>
        error instanceof ModelProviderTestFailed
          ? error
          : (failure ?? new ModelProviderTestFailed({ reason: "network" })),
      ),
    )
    if (!completed || !hasText)
      return yield* failure ?? new ModelProviderTestFailed({ reason: "empty" })
  },
  Effect.timeoutOrElse({
    duration: "30 seconds",
    orElse: () => Effect.fail(new ModelProviderTestFailed({ reason: "timeout" })),
  }),
)
