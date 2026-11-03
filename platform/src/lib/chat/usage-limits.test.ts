import { OrganizationIdSchema, TenantIdSchema, TenantUserIdSchema } from "@/db/schema/organizations"
import {
  chat,
  EventType,
  maxIterations,
  toolDefinition,
  type ChatMiddleware,
  type StreamChunk,
  type TokenUsage,
} from "@tanstack/ai"
import { fakeText } from "@tanstack/ai/testing"
import { Effect } from "effect"
import { expect, it } from "vitest"

import { UsageLimitReached } from "@/lib/usage-limits/errors"
import type { UsageLimit, UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { chatFailedUsageMiddleware, chatUsageLimitGuard } from "./usage-limits.ts"

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
    subject: {
      organizationId: OrganizationIdSchema.make("019a0000-0000-7000-8000-000000000001"),
      tenantId: TenantIdSchema.make("019a0000-0000-7000-8000-000000000002"),
      tenantUserId: TenantUserIdSchema.make("019a0000-0000-7000-8000-000000000003"),
    },
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
    threadId: "usage-test",
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

it.each([
  { usage: { promptTokens: 100, completionTokens: 2, totalTokens: 102 }, expected: 102 },
  { usage: [{ inputTokens: 100, outputTokens: 2, totalTokens: 102 }], expected: 102 },
  { usage: undefined, expected: undefined },
])(
  "accounts for a successful phase followed by failed usage: $usage",
  async ({ usage, expected }) => {
    const adapter = fakeText()
    adapter.setResponses([{ toolCalls: [{ name: "lookup", input: {} }] }])
    const stream = adapter.chatStream.bind(adapter)
    adapter.chatStream = async function* (options) {
      if (adapter.state.callCount === 0) {
        yield* stream(options)
        return
      }
      yield {
        type: EventType.RUN_ERROR,
        message: "Synthetic interruption",
        ...(usage ? { usage } : {}),
      }
    }
    const recorded: TokenUsage[] = []
    const consumer: ChatMiddleware = {
      name: "usage-consumer",
      onUsage: (_ctx, usage) => void recorded.push(usage),
    }
    const source = chat({
      threadId: "failed-usage-test",
      adapter,
      messages: [{ role: "user", content: "Look up" }],
      tools: [toolDefinition({ name: "lookup", description: "Look up" }).server(() => "42")],
      middleware: [chatFailedUsageMiddleware([consumer]), consumer],
    })
    expect((await Array.fromAsync(source)).at(-1)?.type).toBe(EventType.RUN_ERROR)
    expect(recorded).toHaveLength(usage ? 2 : 1)
    expect(recorded[1]?.totalTokens).toBe(expected)
  },
)
