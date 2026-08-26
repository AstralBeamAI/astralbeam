import { expect, test } from "vitest"

import { corsHeaders, isChatRequestTooLarge } from "./utils.server"

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
