import { assert, it } from "@effect/vitest"
import { Effect } from "effect"

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
