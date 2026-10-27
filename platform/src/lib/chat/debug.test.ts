import { EventType } from "@tanstack/ai"
import { Effect, Logger } from "effect"
import { expect, it } from "vitest"

import { chatDebugLogger } from "./debug"

it("routes redacted native metadata through the run's Effect logger without changing inputs", async () => {
  const lines: string[] = []
  const capture = Logger.layer([Logger.map(Logger.formatJson, (line) => lines.push(line))])
  let logged = Promise.resolve()
  const logger = chatDebugLogger({
    runId: "debug-run",
    execute: (effect) => (logged = Effect.runPromise(effect.pipe(Effect.provide(capture)))),
  })
  const input = {
    changes: {
      providerMessages: [{ content: [{ type: "image", source: { value: "attachment-secret" } }] }],
    },
    chunk: { type: EventType.RUN_ERROR, message: "provider-secret" },
    error: Object.assign(new Error("provider-message-secret"), { code: "access_denied" }),
    rawEvent: { body: "raw-event-secret" },
    headers: { authorization: "header-secret" },
    apiKey: "key-secret",
    result: "Useful tool output",
  }
  const original = JSON.stringify(input)

  logger.debug("[tanstack-ai:provider] chunk", input)
  await logged

  expect(lines[0]).toContain('"runId":"debug-run"')
  expect(lines[0]).toContain("Useful tool output")
  expect(lines[0]).toContain("access_denied")
  expect(lines[0]).not.toContain("-secret")
  expect(JSON.stringify(input)).toBe(original)
})
