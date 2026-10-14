import {
  chat,
  EventType,
  maxIterations,
  toolDefinition,
  type ChatMiddleware,
  type StreamChunk,
} from "@tanstack/ai"
import { fakeText } from "@tanstack/ai/testing"
import { Effect } from "effect"
import { expect, it } from "vitest"

import { UsageLimitReached } from "@/lib/usage-limits/errors"
import type { UsageLimit, UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { chatUsageLimitGuard } from "./usage-limits.ts"

it("stops before the next model call and announces the limit once before the run finishes", async () => {
  const adapter = fakeText()
  adapter.setResponses([{ toolCalls: [{ name: "lookup", input: {} }] }, { text: "unreachable" }])
  const recorded: number[] = []
  const usageLimits = {
    record: ({ usage }: { usage: { tokens: number } }) =>
      Effect.sync(() => void recorded.push(usage.tokens)),
    check: () =>
      recorded.length === 0
        ? Effect.void
        : Effect.fail(
            new UsageLimitReached({
              usageLimit: { name: "Session limit", resetsAt: "2026-10-14T15:00:00.000Z" },
              retryAfterSeconds: 60,
            }),
          ),
  } as unknown as UsageLimits["Service"]
  const guard = chatUsageLimitGuard({
    usageLimits,
    limits: [{} as UsageLimit],
    subject: { organizationId: "org", tenantId: "tenant", tenantUserId: "user" },
    pricing: null,
    execute: Effect.runPromise,
  })
  // Managed persistence holds the finish until its delivery ends the stream.
  const held: StreamChunk[] = []
  const holdFinish: ChatMiddleware = {
    name: "hold-finish",
    onChunk: (_ctx, chunk) =>
      chunk.type === EventType.RUN_FINISHED ? (held.push(chunk), null) : undefined,
  }
  async function* deliver(source: AsyncIterable<StreamChunk>) {
    yield* source
    yield* held
  }
  const source = chat({
    adapter,
    messages: [{ role: "user", content: "Look it up" }],
    tools: [
      toolDefinition({ name: "lookup", description: "Look up" }).server(() =>
        Promise.resolve("42"),
      ),
    ],
    agentLoopStrategy: maxIterations(5),
    middleware: [holdFinish, guard.middleware],
  })

  const types: string[] = []
  for await (const chunk of guard.announce(deliver(source)))
    types.push(chunk.type === EventType.CUSTOM ? `CUSTOM ${chunk.name}` : chunk.type)

  expect(adapter.state.callCount).toBe(1)
  expect(recorded).toHaveLength(1)
  expect(types.filter((type) => type.startsWith("CUSTOM"))).toEqual([
    "CUSTOM astralbeam.usage_limit.reached",
  ])
  expect(types.slice(-2)).toEqual(["CUSTOM astralbeam.usage_limit.reached", "RUN_FINISHED"])
})
