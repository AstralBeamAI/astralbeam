import {
  chat,
  EventType,
  StreamProcessor,
  toolDefinition,
  type StreamChunk,
  type ModelMessage,
} from "@tanstack/ai"
import { Effect, Schema } from "effect"
import { expect, test } from "vitest"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import type { ModelConfiguration } from "@/lib/model-providers/schemas"
import { createChatAdapter } from "./adapter"
import { chatWebState, chatWebTools, fetchChatWeb } from "./web"
import { modelWebAccess } from "@/lib/model-providers/web.server"
import { managedChatMiddleware, managedChatDelivery } from "./threads/stream"
import { projectChatModelHistory, projectChatPublicHistory } from "./threads/projection"
import type { ChatThreads } from "./threads/threads"
import type { ChatMessagePayload, ChatWriterClaim, ChatToolResolution } from "./threads/schemas"
import { CHAT_MAX_MODEL_TURNS } from "./constants"

const webAnswer = "Verified answer."
const webSourceFixture = { url: "https://example.com/page", title: "Example" }

function webResponse(
  provider: ChatModelConfiguration["providerType"],
  pause = false,
  application = false,
  failure = false,
) {
  let events: object[]
  if (provider === "anthropic") {
    const blocks = [
      {
        type: "server_tool_use",
        id: "search",
        name: "web_fetch",
        input: { url: webSourceFixture.url },
      },
      {
        type: "web_fetch_tool_result",
        tool_use_id: "search",
        content: failure
          ? { type: "web_fetch_tool_result_error", error_code: "unavailable" }
          : {
              type: "web_fetch_result",
              url: webSourceFixture.url,
              content: {
                type: "document",
                title: "Example",
                source: { type: "text", media_type: "text/plain", data: "Actual page" },
              },
            },
      },
      { type: "text", text: "", citations: [] },
      ...(application ? [{ type: "tool_use", id: "call", name: "lookup", input: {} }] : []),
    ]
    events = [
      {
        type: "message_start",
        message: {
          id: "response",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 2 },
        },
      },
    ]
    for (const [index, block] of blocks.entries()) {
      events.push({ type: "content_block_start", index, content_block: block })
      if (block.type === "text")
        events.push(
          { type: "content_block_delta", index, delta: { type: "text_delta", text: webAnswer } },
          {
            type: "content_block_delta",
            index,
            delta: {
              type: "citations_delta",
              citation: {
                type: "char_location",
                document_index: 1,
                document_title: "Example",
                cited_text: "Actual page",
                start_char_index: 0,
                end_char_index: 11,
              },
            },
          },
        )
      events.push({ type: "content_block_stop", index })
    }
    events.push(
      {
        type: "message_delta",
        delta: { stop_reason: pause ? "pause_turn" : application ? "tool_use" : "end_turn" },
        usage: { output_tokens: 5, server_tool_use: { web_fetch_requests: 1 } },
      },
      { type: "message_stop" },
    )
  } else if (provider === "openai" || provider === "xai") {
    const search = {
      type: "web_search_call",
      id: "search",
      status: "completed",
      action: { type: "open_page", url: webSourceFixture.url },
    }
    const message = {
      type: "message",
      id: "answer",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: webAnswer,
          annotations: [
            {
              type: "url_citation",
              ...webSourceFixture,
              start_index: 0,
              end_index: webAnswer.length,
            },
          ],
        },
      ],
    }
    const call = {
      type: "function_call",
      id: "function-item",
      call_id: "call",
      name: "lookup",
      arguments: "{}",
      status: "completed",
    }
    events = [
      { type: "response.created", response: { id: "response", model: "test-model", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...search, status: "in_progress" },
      },
      { type: "response.output_item.done", output_index: 0, item: search },
      { type: "response.output_item.added", output_index: 1, item: { ...message, content: [] } },
      {
        type: "response.output_text.delta",
        item_id: "answer",
        output_index: 1,
        content_index: 0,
        delta: webAnswer,
      },
      { type: "response.output_item.done", output_index: 1, item: message },
      ...(application
        ? [
            { type: "response.output_item.added", output_index: 2, item: call },
            { type: "response.output_item.done", output_index: 2, item: call },
          ]
        : []),
      {
        type: "response.completed",
        response: {
          id: "response",
          model: "test-model",
          status: "completed",
          output: [search, message, ...(application ? [call] : [])],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]
  } else {
    const envelope = {
      id: "response",
      object: "chat.completion.chunk",
      created: 1,
      model: "test-model",
    }
    events = [
      {
        ...envelope,
        choices: [
          {
            index: 0,
            delta: {
              reasoning_details: [
                { type: "reasoning.encrypted", data: "signed-context", id: "reasoning", index: 0 },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...envelope,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: webAnswer,
              ...(application
                ? {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call",
                        type: "function",
                        function: { name: "lookup", arguments: "{}" },
                      },
                    ],
                  }
                : {}),
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    ...webSourceFixture,
                    start_index: 0,
                    end_index: webAnswer.length,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...envelope,
        choices: [{ index: 0, delta: {}, finish_reason: application ? "tool_calls" : "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0.012,
          server_tool_use: { web_search_requests: 1 },
        },
      },
    ]
  }
  return new Response(
    events
      .map(
        (event) =>
          `${provider === "anthropic" ? `event: ${(event as { type: string }).type}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
      )
      .join("") + (provider === "openrouter" ? "data: [DONE]\n\n" : ""),
    { headers: { "Content-Type": "text/event-stream" } },
  )
}

async function exerciseWeb(
  provider: "openai" | "xai" | "anthropic" | "openrouter",
  options: {
    pause?: "once" | "always"
    application?: "server" | "browser"
    failure?: boolean
    cancel?: boolean
    reject?: boolean
    slow?: boolean
    pricing?: (request: number) => ModelConfiguration
  } = {},
) {
  const requests: Schema.JsonObject[] = []
  const release = Promise.withResolvers<void>()
  const signals: AbortSignal[] = []
  const model: ChatModelConfiguration = {
    providerId: "provider",
    providerName: provider,
    providerType: provider,
    api:
      provider === "openai" || provider === "xai"
        ? "responses"
        : provider === "anthropic"
          ? "anthropic-messages"
          : "chat-completions",
    modelId: "test-model",
    apiKey: "synthetic-key",
    baseUrl: "https://provider.example/v1",
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(Schema.decodeUnknownSync(Schema.JsonObject)(await request.json()))
      signals.push(request.signal)
      if (options.reject)
        return Response.json(
          {
            error: {
              type: "invalid_request_error",
              message: "web_search rejected synthetic-key private-endpoint",
            },
          },
          { status: 400 },
        )
      const response = webResponse(
        provider,
        options.pause === "always" || (options.pause === "once" && requests.length === 1),
        Boolean(options.application) && requests.length === 1,
        options.failure,
      )
      if (!options.slow) return response
      const text = await response.text()
      const split =
        text.indexOf(
          "\n\n",
          text.indexOf(provider === "anthropic" ? '"server_tool_use"' : '"web_search_call"'),
        ) + 2
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode(text.slice(0, split)))
            await release.promise
            controller.enqueue(new TextEncoder().encode(text.slice(split)))
            controller.close()
          },
        }),
        { headers: response.headers },
      )
    },
  }
  const web = chatWebState()
  const saved: ChatMessagePayload[] = []
  let results = 0
  const claim: ChatWriterClaim = {
    scope: {
      organizationId: crypto.randomUUID(),
      tenantId: crypto.randomUUID(),
      tenantUserId: crypto.randomUUID(),
    },
    threadId: crypto.randomUUID(),
    inputMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
  }
  const managed = { claim, threadVersion: 1, clientId: "browser" }
  const inputParts = [
    { type: "text", content: "Read the web" } as const,
    {
      type: "document",
      source: { type: "data", value: "JVBERi0xLjQK", mimeType: "application/pdf" },
      metadata: { filename: "notes.pdf" },
    } as const,
  ]
  const history: ModelMessage[] = [
    {
      id: claim.inputMessageId,
      role: "user",
      content: inputParts,
    },
  ]
  const lookup = toolDefinition({
    name: "lookup",
    description: "Application",
    inputSchema: { type: "object" },
  })
  const tools = [
    ...chatWebTools(model, true, []),
    ...(options.application
      ? [options.application === "browser" ? lookup.client() : lookup.server(() => "found")]
      : []),
  ]
  const records = new Map<string, Parameters<typeof projectChatModelHistory>[0][number]>([
    [
      claim.inputMessageId,
      {
        id: claim.inputMessageId,
        role: "user",
        state: "complete",
        payload: {
          version: 1,
          parts: inputParts.map((part) => ({ ...part, id: crypto.randomUUID() })),
        },
      },
    ],
  ])
  const threads = {
    checkpoint: ({
      claim: current,
      payload,
      state,
    }: {
      claim: ChatWriterClaim
      payload: ChatMessagePayload
      state: "draft" | "complete"
    }) =>
      Effect.sync(() => {
        saved.push(payload)
        records.set(current.assistantMessageId, {
          id: current.assistantMessageId,
          role: "assistant",
          state,
          payload,
        })
      }),
    assertActive: () => Effect.void,
    nextDraft: ({ claim: previous }: { claim: ChatWriterClaim }) =>
      Effect.succeed({ ...previous, assistantMessageId: crypto.randomUUID() }),
    appendToolResults: ({ results: resolutions }: { results: readonly ChatToolResolution[] }) =>
      Effect.sync(() => {
        results++
        for (const result of resolutions) {
          const id = crypto.randomUUID()
          records.set(id, {
            id,
            role: "tool",
            state: "complete",
            payload: result.payload,
            sourceAssistantMessageId: result.assistantMessageId,
            sourceToolPartId: result.toolPartId,
            responseTargetId: result.responseTargetId,
          })
        }
      }),
    finish: () => Effect.void,
    get: () => Effect.succeed({ lockVersion: 2 }),
  } as unknown as ChatThreads["Service"]
  const bridge = managedChatMiddleware({
    managed,
    threads,
    history,
    publicHistory: [],
    tools,
    model,
    web,
    agentId: "agent",
    execute: Effect.runPromise,
    refreshContext: () =>
      Promise.resolve({
        providerMessages: projectChatModelHistory([...records.values()], {
          providerId: model.providerId,
          protocol: model.api,
          modelId: model.modelId,
          webAccessEnabled: true,
        }),
        publicHistory: projectChatPublicHistory([...records.values()]),
        tools,
        systemPrompts: [],
      }),
  })
  const controller = new AbortController()
  const chunks: StreamChunk[] = []
  try {
    for await (const chunk of managedChatDelivery({
      managed,
      state: bridge.state,
      source: chat({
        adapter: createChatAdapter(
          model,
          web,
          options.pricing ? () => options.pricing!(requests.length) : undefined,
        ),
        messages: history,
        tools,
        threadId: claim.threadId,
        abortController: controller,
        middleware: bridge.middleware,
      }),
    })) {
      chunks.push(chunk)
      if (options.slow && chunk.type === EventType.MESSAGES_SNAPSHOT) release.resolve()
      if (options.cancel && chunk.type === EventType.TEXT_MESSAGE_CONTENT) controller.abort()
    }
  } catch (error) {
    if (!options.cancel && !options.reject && options.pause !== "always") throw error
  }
  return { model, web, saved, chunks, requests, signals, results }
}

test.each(["openai", "anthropic"] as const)(
  "%s delivers pending Web activity before retrieval completes",
  async (provider) => {
    const result = await exerciseWeb(provider, { slow: true })
    const snapshots = result.chunks.filter((chunk) => chunk.type === EventType.MESSAGES_SNAPSHOT)
    const processor = new StreamProcessor()
    processor.processChunk(snapshots[0]!)
    const pending = processor
      .getMessages()
      .at(-1)!
      .parts.find((part) => part.type === "tool-call")!
    const completed = result.saved
      .at(-1)!
      .parts.find((part) => part.executionLocation === "provider")!
    expect(pending).toMatchObject({ name: "web_access", state: "input-complete", targets: [] })
    expect(pending).not.toHaveProperty("output")
    expect(completed).toMatchObject({ id: pending.id, state: "complete" })
  },
)

test("Responses streamed citations in later output and content parts keep one correct offset", async () => {
  const state = chatWebState()
  const annotation = { type: "url_citation", ...webSourceFixture, start_index: 0, end_index: 6 }
  const part = { type: "output_text", text: "Answer", annotations: [annotation] }
  const first = {
    type: "message",
    content: [{ type: "output_text", text: "Intro. ", annotations: [] }],
  }
  const second = {
    type: "message",
    content: [{ type: "output_text", text: "More. ", annotations: [] }, part],
  }
  const events = [
    { type: "response.output_item.done", output_index: 0, item: first },
    { type: "response.output_item.added", output_index: 1, item: { type: "message", content: [] } },
    {
      type: "response.content_part.done",
      output_index: 1,
      content_index: 0,
      part: second.content[0],
    },
    {
      type: "response.output_text.annotation.added",
      output_index: 1,
      content_index: 1,
      annotation,
    },
    { type: "response.output_item.done", output_index: 1, item: second },
    { type: "response.completed", response: { output: [first, second] } },
  ]
  const response = await fetchChatWeb(
    {
      api: "responses",
      providerType: "openai",
      fetch: () =>
        Promise.resolve(
          new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
        ),
    },
    state,
    "https://provider.example/v1/responses",
    { method: "POST", body: "{}" },
  )
  await response.text()
  expect(state.evidence.citations).toEqual([
    { ...webSourceFixture, startIndex: 13, endIndex: 19, number: 1 },
  ])
})

test.each(["openai", "xai", "anthropic", "openrouter"] as const)(
  "%s native-only evidence survives delivery, reload, and compatible replay",
  async (provider) => {
    const result = await exerciseWeb(provider)
    const payload = result.saved.at(-1)!
    expect(payload.parts.find((part) => part.type === "text")).toMatchObject({
      metadata: { web: { citations: [{ url: webSourceFixture.url, number: 1 }] } },
    })
    expect(payload.parts.find((part) => part.executionLocation === "provider")).toMatchObject({
      targets: [],
      state: "complete",
      metadata: { web: { sources: [webSourceFixture] } },
    })
    expect(result.results).toBe(0)
    const processor = new StreamProcessor()
    for (const chunk of result.chunks) processor.processChunk(chunk)
    expect(processor.getMessages().at(-1)!.parts).toEqual(payload.parts)
    expect(JSON.stringify(result.chunks)).not.toContain("webProviderContext")
    expect(result.requests[0]!.max_tool_calls).toBe(provider === "anthropic" ? undefined : 5)
    expect(JSON.stringify(result.requests[0]!.tools)).toContain(
      provider === "openrouter" ? "openrouter:web_search" : "web_search",
    )
    expect(JSON.stringify(result.requests[0])).toContain(
      provider === "openrouter"
        ? '"file_data":"data:application/pdf;base64,JVBERi0xLjQK"'
        : "JVBERi0xLjQK",
    )
    expect(payload.provenance?.usage).toHaveProperty("providerUsageDetails.requests")
    expect((payload.provenance?.usage as { cost?: number } | undefined)?.cost).toBe(
      provider === "openrouter" ? 0.012 : undefined,
    )
    const record = { id: "saved", role: "assistant" as const, state: "complete" as const, payload }
    const target = {
      providerId: result.model.providerId,
      protocol: result.model.api,
      modelId: result.model.modelId,
    }
    const compatible = projectChatModelHistory([record], target)
    expect(compatible[0]!.metadata).toHaveProperty("webProviderContext")
    const requests: unknown[] = []
    for await (const _chunk of chat({
      threadId: "web-replay-test",
      adapter: createChatAdapter(
        {
          ...result.model,
          fetch: async (input, init) => {
            requests.push(await new Request(input, init).json())
            return webResponse(provider)
          },
        },
        chatWebState(),
      ),
      messages: [
        ...compatible,
        { role: "assistant", content: "Additional note." },
        { role: "user", content: "Explain the evidence" },
      ],
      tools: chatWebTools(result.model, true, []),
    })) {
      // Drain the real adapter to inspect its outgoing replay request.
    }
    expect(JSON.stringify(requests)).not.toContain("webProviderContext")
    expect(JSON.stringify(requests)).toContain(webSourceFixture.url)
    expect(JSON.stringify(requests)).toContain("Additional note.")
    const portable = projectChatModelHistory([record], { ...target, providerId: "other" })
    expect(JSON.stringify(portable)).not.toContain("webProviderContext")
    expect(JSON.stringify(portable)).toContain(webSourceFixture.url)
  },
)

test.each(
  (["openai", "xai", "anthropic", "openrouter"] as const).flatMap((provider) =>
    (["server", "browser"] as const).map((application) => ({ provider, application })),
  ),
)(
  "$provider mixed native and $application calls retain executable identities and only application slots",
  async ({ provider, application }) => {
    const result = await exerciseWeb(provider, { application })
    expect(result.requests).toHaveLength(application === "server" ? 2 : 1)
    expect(result.results).toBe(application === "server" ? 1 : 0)
    const decision = result.saved.find((payload) =>
      payload.parts.some((part) => part.name === "lookup"),
    )!
    expect(JSON.stringify(decision.modelMessages)).toContain('"name":"lookup"')
    expect(JSON.stringify(decision.modelMessages)).not.toContain('"id":"function-item"')
    const wire = JSON.stringify(
      result.requests[1]?.[result.model.api === "responses" ? "input" : "messages"] ?? [],
    )
    expect(wire.includes('"name":"lookup"')).toBe(application === "server")
    expect(JSON.stringify(decision.modelMessages).includes("signed-context")).toBe(
      provider === "openrouter",
    )
    expect(wire.includes("signed-context")).toBe(
      provider === "openrouter" && application === "server",
    )
    expect(
      decision.parts.filter((part) => part.type === "tool-call").map((part) => part.targets),
    ).toMatchObject([[{}], []])
    const snapshot = result.chunks.find(
      (chunk) =>
        chunk.type === EventType.MESSAGES_SNAPSHOT &&
        JSON.stringify(chunk.messages).includes('"lookup"'),
    )!
    const processor = new StreamProcessor()
    processor.processChunk(snapshot)
    expect(
      processor
        .getMessages()
        .flatMap((message) => message.parts)
        .find((part) => part.type === "tool-call" && part.name === "lookup"),
    ).toMatchObject({
      id: "call",
      applicationPartId: decision.parts.find((part) => part.name === "lookup")!.id,
    })
  },
)

test("native errors and cancellation retain observed evidence without application responses", async () => {
  const failure = await exerciseWeb("anthropic", { failure: true })
  expect(
    failure.saved.at(-1)!.parts.find((part) => part.executionLocation === "provider")?.state,
  ).toBe("error")
  const cancelled = await exerciseWeb("openai", { cancel: true })
  expect(cancelled.signals.every((signal) => signal.aborted)).toBe(true)
  expect(cancelled.requests).toHaveLength(1)
  expect(cancelled.results).toBe(0)
  expect(cancelled.saved.at(-1)!.parts.some((part) => part.executionLocation === "provider")).toBe(
    true,
  )
})

test.each(["once", "always"] as const)(
  "Anthropic %s pause preserves context and stays within the turn budget",
  async (pause) => {
    const result = await exerciseWeb("anthropic", {
      pause,
      pricing: (request) => ({
        currency: "USD",
        pricingSource: { kind: "manual" },
        prices: { inputPerMillion: request === 1 ? "2" : "4", outputPerMillion: "8" },
        contextTiers: [],
        maxInputTokens: 128_000,
        contextWindowTokens: null,
        maxOutputTokens: 8192,
        outputCap: 4096,
      }),
    })
    expect(result.requests).toHaveLength(pause === "once" ? 2 : CHAT_MAX_MODEL_TURNS)
    expect(JSON.stringify(result.requests[1])).toContain("web_fetch_result")
    const usage = Schema.decodeUnknownSync(Schema.UndefinedOr(Schema.JsonObject))(
      result.saved.at(-1)!.provenance?.usage,
    )
    expect([usage?.promptTokens, usage?.completionTokens, usage?.totalTokens]).toEqual(
      pause === "once" ? [24, 10, 34] : [undefined, undefined, undefined],
    )
    expect(usage?.promptTokensDetails).toEqual(pause === "once" ? { cachedTokens: 4 } : undefined)
    expect(usage?.costUsd).toBe(pause === "once" ? "0.000152" : undefined)
    expect(result.chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(
      pause === "always",
    )
  },
)

test("disabled access, unsupported models and reserved browser names enforce the grant", () => {
  const model = {
    providerType: "openai",
    api: "chat-completions",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-audio",
  } as ChatModelConfiguration
  expect(chatWebTools(model, false, [{ name: "web_search", description: "Browser tool" }])).toEqual(
    [],
  )
  expect(() => chatWebTools(model, true, [])).toThrow()
  expect(() => chatWebTools({ ...model, api: "responses" }, true, [])).toThrow()
  const grok = { providerType: "xai", api: "responses", baseUrl: "https://api.x.ai/v1" } as const
  expect(modelWebAccess({ ...grok, modelId: "grok-4.7" })).toBe(true)
  expect(modelWebAccess({ ...grok, modelId: "grok-custom" })).toBeNull()
  expect(() =>
    chatWebTools({ ...model, api: "responses", modelId: "custom" }, true, [
      { name: "web_fetch", description: "Browser tool" },
    ]),
  ).toThrow()
})

test("native rejection is classified without retry", async () => {
  const result = await exerciseWeb("openai", { reject: true })
  expect(result.requests).toHaveLength(1)
  expect(result.chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)).toMatchObject({
    code: "web_access_unavailable",
  })
  expect(result.chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)?.message).toBe(
    "The provider rejected web access. Check the model and provider web-tool permissions.",
  )
})
