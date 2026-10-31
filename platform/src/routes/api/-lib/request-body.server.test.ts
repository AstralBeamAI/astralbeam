import { assert, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

import { readRequestJson } from "./request-body.server"

it.effect("bounds a request body when content-length is absent", () =>
  Effect.gen(function* () {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":'))
        controller.enqueue(new TextEncoder().encode('"too large"}'))
        controller.close()
      },
    })
    const request = new Request("https://chat.example/api/v1/chat", {
      method: "POST",
      body,
    })

    assert.isFalse(request.headers.has("content-length"))
    assert.strictEqual((yield* Effect.flip(readRequestJson(request, 8)))._tag, "RequestTooLarge")
  }),
)

it.effect("cancels a stalled request body after the read deadline", () =>
  Effect.gen(function* () {
    let cancelled = false
    const request = new Request("https://chat.example/api/v1/chat", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true
        },
      }),
    })
    const reading = yield* Effect.forkChild(Effect.flip(readRequestJson(request, 1024)))
    yield* TestClock.adjust("30 seconds")
    assert.strictEqual((yield* Fiber.join(reading))._tag, "RequestBodyInvalid")
    assert.isTrue(cancelled)
  }),
)
