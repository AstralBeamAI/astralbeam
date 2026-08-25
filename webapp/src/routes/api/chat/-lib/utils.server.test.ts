import { expect, test } from "vitest"

import { corsHeaders } from "./utils.server"

test("allows only the headers used by the authenticated chat transport", () => {
  const request = new Request("https://chat.example/api/chat", { method: "POST" })
  expect(corsHeaders(request)["access-control-allow-headers"]).toBe(
    "authorization, content-type, last-event-id, x-run-id",
  )
})
