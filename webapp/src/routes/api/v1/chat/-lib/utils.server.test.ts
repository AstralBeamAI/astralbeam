import { expect, test } from "vitest"

import { ChatRequestTooLargeError, readChatRequestJson } from "./utils.server"

test("bounds a request body when content-length is absent", async () => {
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

  expect(request.headers.has("content-length")).toBe(false)
  await expect(readChatRequestJson(request, 8)).rejects.toBeInstanceOf(
    ChatRequestTooLargeError,
  )
})
