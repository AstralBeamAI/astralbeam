import { AsyncLocalStorage } from "node:async_hooks"
import type { NitroApp } from "nitro/types"
import { expect, test } from "vitest"

import requestContextPlugin from "./request-context.server"

test("runs each request outside the async context it was dispatched in", async () => {
  const storage = new AsyncLocalStorage<string>()
  const nitro: NitroApp = { fetch: () => new Response(storage.getStore() ?? "clean") }
  requestContextPlugin(nitro)

  const response = await storage.run("stale transaction", () =>
    nitro.fetch(new Request("http://app.test/")),
  )

  expect(await response.text()).toBe("clean")
})
