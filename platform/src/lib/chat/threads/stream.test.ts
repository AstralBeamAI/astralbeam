import {
  chat,
  EventType,
  toolDefinition,
  type ChatMiddleware,
  type ModelMessage,
  type StreamChunk,
  type Tool,
} from "@tanstack/ai"
import { Effect, Schema } from "effect"
import { describe, expect, test } from "vitest"

import { createChatAdapter, modelOutputOptions } from "../adapter"
import { chatToolInputSchema } from "../tool-schema"
import type { ChatThreads } from "./threads"
import type { ChatMessagePayload, ChatToolResolution, ChatWriterClaim } from "./schemas"
import { managedChatDelivery, managedChatMiddleware } from "./stream"

const managedStreamClaim: ChatWriterClaim = {
  scope: {
    organizationId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    tenantUserId: crypto.randomUUID(),
  },
  threadId: crypto.randomUUID(),
  assistantMessageId: crypto.randomUUID(),
  inputMessageId: crypto.randomUUID(),
  invocationId: crypto.randomUUID(),
}

function managedProviderResponse(tool: boolean) {
  const delta = tool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "change", arguments: "{}" },
          },
        ],
      }
    : { role: "assistant", content: "Saved answer" }
  const chunks = [
    { id: "completion", model: "test-model", choices: [{ index: 0, delta, finish_reason: null }] },
    {
      id: "completion",
      model: "test-model",
      choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ]
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

async function exerciseManagedStream(options: {
  browser?: boolean
  failDecision?: boolean
  failFinal?: boolean
  failSnapshot?: boolean
  failTool?: boolean
  invalidInput?: boolean
  failResult?: boolean
  unknownTool?: boolean
  snapshots?: boolean
  authorizationFailure?: "model" | "tool"
  refresh?: boolean
}) {
  const order: string[] = []
  const saved: ChatMessagePayload[] = []
  const results: ChatToolResolution[] = []
  const prompts: unknown[] = []
  const nextAssistantId = crypto.randomUUID()
  let requests = 0
  let executed = 0
  let snapshotVersion = 0
  let bufferedSnapshots = 0
  const model = {
    providerId: "provider",
    providerName: "Synthetic",
    providerType: "openai" as const,
    api: "chat-completions" as const,
    modelId: "test-model",
    outputCap: 4096,
    apiKey: "synthetic-test-key",
    baseUrl: "https://model.example/v1",
    fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Expected provider JSON request")
      prompts.push(JSON.parse(init.body))
      requests += 1
      return Promise.resolve(managedProviderResponse(requests === 1))
    },
  }
  const definition = toolDefinition({
    name: options.unknownTool ? "different" : "change",
    description: "Test action",
    inputSchema: options.invalidInput
      ? chatToolInputSchema(Schema.Struct({ required: Schema.String }))
      : { type: "object", properties: {} },
  })
  const tool = options.browser
    ? definition.client()
    : definition.server(() => {
        order.push("execute")
        executed += 1
        if (options.failTool) throw new Error("Synthetic external outcome uncertainty")
        return Promise.resolve({ updated: true })
      })
  const threads = {
    checkpoint: ({ payload, state }: { payload: ChatMessagePayload; state: string }) =>
      Effect.sync(() => {
        if (state === "complete" && options.failDecision)
          throw new Error("Synthetic decision save failure")
        if (
          options.failSnapshot &&
          state === "draft" &&
          payload.parts.some((part) => part.type === "text" && part.content === "Saved answer")
        )
          throw new Error("Synthetic terminal transcript failure")
        saved.push(payload)
        if (state === "complete") order.push("decision")
      }),
    assertActive: () =>
      Effect.sync(() => {
        order.push("authorize")
        if (
          options.authorizationFailure === "model" ||
          (options.authorizationFailure === "tool" && order.includes("decision"))
        )
          throw new Error("Invocation revoked")
      }),
    nextDraft: ({ claim }: { claim: ChatWriterClaim }) =>
      Effect.sync(() => {
        order.push("next-draft")
        return { ...claim, assistantMessageId: nextAssistantId }
      }),
    appendToolResults: (input: { results: readonly ChatToolResolution[] }) =>
      Effect.sync(() => {
        if (options.failResult) throw new Error("Synthetic result save failure")
        results.push(...input.results)
        order.push("result")
      }),
    finish: () =>
      options.failFinal
        ? Effect.die("Synthetic final save failure")
        : Effect.sync(() => {
            order.push("finish")
          }),
    get: () => Effect.succeed({ lockVersion: 3 }),
  } as unknown as ChatThreads["Service"]
  const history: ModelMessage[] = [
    { id: managedStreamClaim.inputMessageId, role: "user", content: "Change it" },
  ]
  const managed = {
    claim: managedStreamClaim,
    threadVersion: 1,
    clientId: crypto.randomUUID(),
  }
  const bridge = managedChatMiddleware({
    managed,
    threads,
    history,
    tools: options.refresh ? [] : [tool],
    model,
    agentId: "agent",
    execute: Effect.runPromise,
    ...(options.refresh
      ? {
          refreshContext: () =>
            Promise.resolve({
              providerMessages: [
                {
                  role: "user" as const,
                  content: requests > 0 ? "New participant input" : "Change it",
                },
              ],
              tools: [tool] as unknown as Tool[],
              systemPrompts: [],
            }),
        }
      : {}),
  })
  const source = chat({
    adapter: createChatAdapter(model),
    modelOptions: modelOutputOptions(model),
    messages: history,
    tools: options.refresh ? [] : [tool],
    threadId: managed.claim.threadId,
    runId: "run",
    middleware: [
      ...(options.snapshots
        ? [
            {
              name: "synthetic-snapshots",
              onChunk(_ctx, chunk) {
                bufferedSnapshots = Math.max(
                  bufferedSnapshots,
                  bridge.state.buffered.filter(
                    (event) => event.type === EventType.MESSAGES_SNAPSHOT,
                  ).length,
                )
                if (!chunk.type.startsWith("TOOL_CALL_")) return
                const snapshot = (): StreamChunk => ({
                  type: EventType.MESSAGES_SNAPSHOT,
                  timestamp: ++snapshotVersion,
                  messages: [{ id: "snapshot", role: "user", content: "Saved upload context" }],
                })
                return [snapshot(), chunk, snapshot()]
              },
            } satisfies ChatMiddleware,
          ]
        : []),
      ...bridge.middleware,
    ],
  })
  const chunks: StreamChunk[] = []
  let failed = false
  try {
    for await (const chunk of managedChatDelivery({ source, managed, state: bridge.state })) {
      if (chunk.type === EventType.TOOL_CALL_END) order.push("delivered")
      chunks.push(chunk)
    }
  } catch {
    failed = true
  }
  return {
    order,
    saved,
    results,
    requests,
    executed,
    chunks,
    failed,
    nextAssistantId,
    prompts,
    snapshotVersion,
    bufferedSnapshots,
  }
}

describe("managed TanStack persistence boundaries", () => {
  test.each(["model", "tool"] as const)(
    "authorization failure before %s work prevents external calls",
    async (authorizationFailure) => {
      const result = await exerciseManagedStream({ authorizationFailure })
      expect(result.failed).toBe(true)
      expect(result.requests).toBe(authorizationFailure === "model" ? 0 : 1)
      expect(result.executed).toBe(0)
      expect(result.order).not.toContain("finish")
    },
  )

  test("commits decisions before server effects and outcomes before the next model call", async () => {
    const result = await exerciseManagedStream({})
    expect(result.failed).toBe(false)
    expect(result.executed).toBe(1)
    expect(result.requests).toBe(2)
    expect(result.prompts).toMatchObject([{ max_tokens: 4096 }, { max_tokens: 4096 }])
    expect(result.results).toHaveLength(1)
    expect(result.order.indexOf("decision")).toBeLessThan(result.order.indexOf("execute"))
    expect(result.order.indexOf("result")).toBeLessThan(result.order.lastIndexOf("decision"))
    expect(
      result.chunks.findIndex((chunk) => chunk.type === EventType.TOOL_CALL_RESULT),
    ).toBeLessThan(
      result.chunks.findLastIndex((chunk) => chunk.type === EventType.TEXT_MESSAGE_START),
    )
    expect(
      result.saved.some((payload) =>
        payload.parts.some((part) => part.executionLocation === "server_api"),
      ),
    ).toBe(true)
    expect(JSON.stringify(result.saved)).not.toContain("synthetic-test-key")
    expect(result.saved.some((payload) => payload.provenance?.usage !== undefined)).toBe(true)
  })

  test("refreshes provider context between phases without replacing canonical saved history", async () => {
    const result = await exerciseManagedStream({ refresh: true })
    expect(result.failed).toBe(false)
    expect(result.requests).toBe(2)
    expect(JSON.stringify(result.prompts[1])).toContain("New participant input")
    expect(
      result.saved.flatMap((payload) => payload.parts).find((part) => part.type === "tool-call"),
    ).toMatchObject({
      executionLocation: "server_api",
      declaration: { inputSchema: { type: "object" } },
    })
  })

  test("a failed decision commit prevents the business effect", async () => {
    const result = await exerciseManagedStream({ failDecision: true })
    expect(result.executed).toBe(0)
    expect(result.failed).toBe(true)
    expect(result.chunks.some((chunk) => chunk.type === EventType.TOOL_CALL_END)).toBe(false)
  })

  test("saves input validation failures before continuing without executing the tool", async () => {
    const result = await exerciseManagedStream({ invalidInput: true })
    expect(result.failed).toBe(false)
    expect(result.executed).toBe(0)
    expect(result.requests).toBe(2)
    expect(result.results).toHaveLength(1)
    const output = result.results[0]!.payload.parts[0]!
    expect(output.outcome).toBe("failed")
    expect(JSON.stringify(output.output)).toContain("Input validation failed")
    expect(result.order.indexOf("result")).toBeLessThan(result.order.indexOf("next-draft"))
  })

  test.each([{ browser: true, invalidInput: true }, { unknownTool: true }])(
    "persists rejected tool calls without leaving an executable browser response: %j",
    async (options) => {
      const result = await exerciseManagedStream(options)
      expect(result.failed).toBe(false)
      expect(result.executed).toBe(0)
      expect(result.requests).toBe(2)
      expect(result.results).toHaveLength(1)
      expect(result.results[0]!.payload.parts[0]!.outcome).toBe("failed")
      expect(result.order.indexOf("result")).toBeLessThan(result.order.indexOf("next-draft"))
    },
  )

  test("a rejected tool result must be saved before another model attempt", async () => {
    const result = await exerciseManagedStream({ invalidInput: true, failResult: true })
    expect(result.failed).toBe(true)
    expect(result.executed).toBe(0)
    expect(result.requests).toBe(1)
    expect(result.order).not.toContain("next-draft")
    expect(result.order).not.toContain("finish")
  })

  test("an unconfirmed server tool outcome is saved without another model attempt", async () => {
    const result = await exerciseManagedStream({ failTool: true })
    expect(result.executed).toBe(1)
    expect(result.requests).toBe(1)
    expect(result.order).toContain("result")
    expect(result.results[0]!.payload.parts[0]!.outcome).toBe("unknown")
    expect(result.failed).toBe(true)
  })

  test("browser execution is delivered only after the waiting decision is saved", async () => {
    const result = await exerciseManagedStream({ browser: true })
    expect(result.failed).toBe(false)
    expect(result.requests).toBe(1)
    expect(result.executed).toBe(0)
    expect(result.order.indexOf("finish")).toBeLessThan(result.order.indexOf("delivered"))
    const decision = result.saved.find((payload) =>
      payload.parts.some((part) => part.type === "tool-call"),
    )
    const targets = Schema.decodeUnknownSync(
      Schema.Array(
        Schema.Struct({ id: Schema.String, tenantUserId: Schema.String, clientId: Schema.String }),
      ),
    )(decision?.parts.find((part) => part.type === "tool-call")?.targets)
    expect(targets).toHaveLength(1)
    expect(targets[0]!.tenantUserId).toBe(managedStreamClaim.scope.tenantUserId)
  })

  test("retains only the latest deferred snapshot while preserving tool-event order", async () => {
    const result = await exerciseManagedStream({ snapshots: true })
    expect(result.failed).toBe(false)
    expect(result.bufferedSnapshots).toBe(1)
    const snapshots = result.chunks.filter((chunk) => chunk.type === EventType.MESSAGES_SNAPSHOT)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.timestamp).toBe(result.snapshotVersion)
    expect(
      result.chunks
        .filter((chunk) => chunk.type.startsWith("TOOL_CALL_"))
        .map((chunk) => chunk.type),
    ).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ])
    expect(result.chunks.indexOf(snapshots[0]!)).toBeGreaterThan(
      result.chunks.findIndex((chunk) => chunk.type === EventType.TOOL_CALL_RESULT),
    )
  })

  test("native terminal persistence failure prevents the application completion acknowledgment", async () => {
    const result = await exerciseManagedStream({ failSnapshot: true })
    expect(result.failed).toBe(true)
    expect(result.order).not.toContain("finish")
    expect(
      result.chunks.some(
        (chunk) =>
          chunk.type === EventType.CUSTOM &&
          Schema.decodeUnknownSync(Schema.JsonObject)(chunk.value).saved === true,
      ),
    ).toBe(false)
  })

  test("final-save failure cannot advertise durable completion or browser execution", async () => {
    const result = await exerciseManagedStream({ browser: true, failFinal: true, snapshots: true })
    expect(result.failed).toBe(true)
    expect(
      result.chunks.some(
        (chunk) =>
          chunk.type === EventType.RUN_FINISHED ||
          chunk.type === EventType.TOOL_CALL_END ||
          chunk.type === EventType.MESSAGES_SNAPSHOT,
      ),
    ).toBe(false)
    expect(
      result.chunks.some(
        (chunk) =>
          chunk.type === EventType.CUSTOM &&
          Schema.decodeUnknownSync(Schema.JsonObject)(chunk.value).saved === true,
      ),
    ).toBe(false)
  })
})
