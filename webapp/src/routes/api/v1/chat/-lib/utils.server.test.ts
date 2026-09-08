import { expect, test } from "vitest"

import {
  ChatRequestTooLargeError,
  corsHeaders,
  isChatRequestTooLarge,
  readChatRequestJson,
} from "./utils.server"

test("allows only the headers used by the authenticated chat transport", () => {
  const request = new Request("https://chat.example/api/chat", { method: "POST" })
  expect(corsHeaders(request)["access-control-allow-headers"]).toBe(
    "authorization, content-type, last-event-id, x-run-id",
  )
})

// Attachments made run inputs large enough to be worth refusing before the body is buffered.
test("refuses a run input past the request size ceiling, and allows an unmeasured one", () => {
  const oversized = new Request("https://chat.example/api/chat", {
    method: "POST",
    headers: { "content-length": String(64 * 1024 * 1024) },
  })
  expect(isChatRequestTooLarge(oversized)).toBe(true)
  expect(isChatRequestTooLarge(new Request("https://chat.example/api/chat", { method: "POST" })))
    .toBe(false)
})

test("bounds a request body when content-length is absent", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":'))
      controller.enqueue(new TextEncoder().encode('"too large"}'))
      controller.close()
    },
  })
  const request = new Request("https://chat.example/api/chat", {
    method: "POST",
    body,
  })

  expect(request.headers.has("content-length")).toBe(false)
  await expect(readChatRequestJson(request, 8)).rejects.toBeInstanceOf(
    ChatRequestTooLargeError,
  )
})
