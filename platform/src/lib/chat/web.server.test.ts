import {
  chat,
  EventType,
  toolDefinition,
  type ModelMessage,
  type StreamChunk,
  type TextOptions,
  type AdapterYieldChunk,
} from "@tanstack/ai"
import process from "node:process"
import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { fetchPublicModelEndpoint } from "@/lib/model-providers/endpoints.server"
import { createChatAdapter } from "./adapter.server"
import { chatWebTools } from "./web.server"
import { managedChatDelivery, managedChatMiddleware } from "./threads/stream.server"
import { projectChatModelHistory } from "./threads/projection.server"
import type { ChatThreads } from "./threads/threads.server"
import type { ChatMessagePayload, ChatWriterClaim } from "./threads/schemas"

const webTestSource = {
  url: "https://example.com/page",
  title: "Example",
  cited_text: "Evidence excerpt",
}

function nativeWebFixture(
  provider: "openai" | "anthropic" | "openrouter",
  pause = false,
  failure = false,
  application = false,
  fetchPage = false,
) {
  const text = "Verified answer."
  let events: object[]
  if (provider === "anthropic") {
    const blocks = [
      {
        type: "server_tool_use",
        id: "native-search",
        name: fetchPage ? "web_fetch" : "web_search",
        input: fetchPage ? { url: webTestSource.url } : { query: "test" },
      },
      {
        type: fetchPage ? "web_fetch_tool_result" : "web_search_tool_result",
        tool_use_id: "native-search",
        content: failure
          ? { type: "web_search_tool_result_error", error_code: "unavailable" }
          : fetchPage
            ? {
                type: "web_fetch_result",
                url: webTestSource.url,
                content: {
                  type: "document",
                  title: webTestSource.title,
                  source: {
                    type: "text",
                    media_type: "text/plain",
                    data: "Actual fetched page content.",
                  },
                  citations: { enabled: true },
                },
              }
            : [
                {
                  type: "web_search_result",
                  ...webTestSource,
                  encrypted_content: "opaque-evidence",
                },
              ],
      },
      { type: "text", text: "", citations: [] },
      ...(application
        ? [{ type: "tool_use", id: "application-call", name: "lookup", input: {} }]
        : []),
    ]
    events = [
      {
        type: "message_start",
        message: {
          id: "native-message",
          type: "message",
          role: "assistant",
          model: "test-model",
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    ]
    blocks.forEach((block, index) => {
      events.push({ type: "content_block_start", index, content_block: block })
      if (block.type === "text")
        events.push(
          { type: "content_block_delta", index, delta: { type: "text_delta", text } },
          {
            type: "content_block_delta",
            index,
            delta: {
              type: "citations_delta",
              citation: fetchPage
                ? {
                    type: "char_location",
                    document_index: 0,
                    document_title: webTestSource.title,
                    cited_text: "Actual fetched page content.",
                    start_char_index: 0,
                    end_char_index: 27,
                  }
                : {
                    type: "web_search_result_location",
                    ...webTestSource,
                    encrypted_index: "opaque-index",
                  },
            },
          },
        )
      events.push({ type: "content_block_stop", index })
    })
    events.push(
      {
        type: "message_delta",
        delta: { stop_reason: pause ? "pause_turn" : application ? "tool_use" : "end_turn" },
        usage: { output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
      },
      { type: "message_stop" },
    )
  } else if (provider === "openai") {
    const search = {
      type: "web_search_call",
      id: "native-search",
      status: "completed",
      action: { type: "search", query: "test", sources: [webTestSource] },
    }
    const message = {
      type: "message",
      id: "native-message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text,
          annotations: [
            { type: "url_citation", ...webTestSource, start_index: 0, end_index: text.length },
          ],
        },
      ],
    }
    events = [
      {
        type: "response.created",
        response: { id: "response-test", model: "test-model", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...search, status: "in_progress" },
      },
      { type: "response.output_item.done", output_index: 0, item: search },
      { type: "response.output_item.added", output_index: 1, item: { ...message, content: [] } },
      {
        type: "response.output_text.delta",
        item_id: message.id,
        output_index: 1,
        content_index: 0,
        delta: text,
      },
      { type: "response.output_item.done", output_index: 1, item: message },
      {
        type: "response.completed",
        response: {
          id: "response-test",
          model: "test-model",
          status: "completed",
          output: [search, message],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    ]
  } else {
    events = [
      {
        id: "gateway-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: text,
              annotations: [
                {
                  type: "url_citation",
                  url_citation: {
                    ...webTestSource,
                    content: "Evidence excerpt",
                    start_index: 0,
                    end_index: text.length,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "gateway-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cost: 0.012,
          server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
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

async function nativeWebRun(
  provider: "openai" | "anthropic" | "openrouter",
  options: {
    pause?: boolean
    failure?: boolean
    application?: boolean
    fetchPage?: boolean
    cancel?: boolean
    model?: ChatModelConfiguration
    prompt?: string
  } = {},
) {
  const requests: Record<string, unknown>[] = []
  const model: ChatModelConfiguration = options.model ?? {
    providerId: "configured-instance",
    providerType: provider,
    providerName: provider,
    api:
      provider === "openai"
        ? "responses"
        : provider === "anthropic"
          ? "anthropic-messages"
          : "chat-completions",
    modelId: "test-model",
    apiKey: "synthetic-secret",
    baseUrl: "https://provider.example/v1",
    fetch: async (input, init) => {
      requests.push(JSON.parse(await new Request(input, init).text()) as Record<string, unknown>)
      return nativeWebFixture(
        provider,
        options.pause && requests.length === 1,
        options.failure,
        options.application && requests.length === 1,
        options.fetchPage,
      )
    },
  }
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
  const history: ModelMessage[] = [
    { role: "user", id: claim.inputMessageId, content: options.prompt ?? "Find evidence" },
  ]
  const managed = { claim, threadVersion: 1, clientId: crypto.randomUUID() }
  const saved: ChatMessagePayload[] = []
  let executed = 0
  let results = 0
  const lookup = toolDefinition({
    name: "lookup",
    description: "Application lookup",
    inputSchema: { type: "object", properties: {} },
  }).server(() => {
    executed++
    return { found: true }
  })
  const tools = [...chatWebTools(model, true, []), ...(options.application ? [lookup] : [])]
  const threads = {
    checkpoint: ({ payload }: { payload: ChatMessagePayload }) =>
      Effect.sync(() => {
        saved.push(payload)
      }),
    assertActive: () => Effect.void,
    nextDraft: ({ claim: previous }: { claim: ChatWriterClaim }) =>
      Effect.succeed({ ...previous, assistantMessageId: crypto.randomUUID() }),
    appendToolResults: () =>
      Effect.sync(() => {
        results++
      }),
    finish: () => Effect.void,
    get: () => Effect.succeed({ lockVersion: 2 }),
  } as unknown as ChatThreads["Service"]
  const bridge = managedChatMiddleware({
    managed,
    threads,
    history,
    tools,
    model,
    agentId: "agent",
    execute: Effect.runPromise,
  })
  const adapter = createChatAdapter(model, true)
  const abortController = new AbortController()
  if (options.cancel) {
    const original = adapter.chatStream.bind(adapter) as (
      input: TextOptions,
    ) => AsyncIterable<AdapterYieldChunk>
    adapter.chatStream = async function* (input: TextOptions) {
      for await (const chunk of original(input)) {
        yield chunk
        if (chunk.type === EventType.TOOL_CALL_START) abortController.abort()
      }
    }
  }
  const chunks: StreamChunk[] = []
  let error: unknown
  try {
    for await (const chunk of managedChatDelivery({
      managed,
      state: bridge.state,
      source: chat({
        adapter,
        threadId: claim.threadId,
        messages: history,
        tools,
        abortController,
        middleware: bridge.middleware,
      }),
    }))
      chunks.push(chunk)
  } catch (cause) {
    if (!options.cancel) throw cause
    error = cause
  }
  return { requests, saved, chunks, executed, results, model, adapter, tools, error }
}

describe("native web access", () => {
  test("interrupted native calls persist as failed activity without pending application results", async () => {
    const result = await nativeWebRun("anthropic", { cancel: true })
    expect(result.error).toMatchObject({ message: "Conversation could not be saved" })
    expect(result.executed).toBe(0)
    expect(result.results).toBe(0)
    expect(result.saved.at(-1)?.parts.find((part) => part.type === "tool-call")).toMatchObject({
      state: "error",
      executionLocation: "provider",
      targets: [],
      output: { error: "Web retrieval failed" },
    })
  })
  test("Anthropic fetched-document citations resolve to the returned URL and excerpt", async () => {
    const result = await nativeWebRun("anthropic", { fetchPage: true })
    const payload = result.saved.at(-1)!
    expect(payload.parts.find((part) => part.type === "text")).toMatchObject({
      metadata: {
        web: {
          citations: [
            {
              url: webTestSource.url,
              title: webTestSource.title,
              excerpt: "Actual fetched page content.",
              endIndex: 16,
            },
          ],
        },
      },
    })
    expect(payload.parts.find((part) => part.type === "tool-call")).toMatchObject({
      name: "web_fetch",
      executionLocation: "provider",
      metadata: {
        web: { sources: [{ url: webTestSource.url, excerpt: "Actual fetched page content." }] },
      },
    })
  })
  test.runIf(process.env.ASTRALBEAM_LIVE_WEB === "1")(
    "authorized OpenAI search, supplied URL, and saved-evidence follow-up",
    async () => {
      const key = process.env.OPENAI_API_KEY
      if (!key) throw new Error("OPENAI_API_KEY is required for the opt-in live test")
      const model: ChatModelConfiguration = {
        providerId: "live",
        providerType: "openai",
        providerName: "OpenAI",
        api: "responses",
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-5.6-terra",
        apiKey: key,
        fetch: (input, init) =>
          fetchPublicModelEndpoint(input, { ...init, signal: AbortSignal.timeout(90_000) }),
      }
      for (const prompt of [
        "Use web search to find the official TanStack AI provider-tool documentation. Cite one source and answer in one sentence.",
        "Use web access to read https://tanstack.com/ai/latest/docs/tools/provider-tools. Cite the page and summarize it in one sentence.",
      ]) {
        const result = await nativeWebRun("openai", { model, prompt })
        const payload = result.saved.at(-1)!
        expect(payload.parts.some((part) => part.executionLocation === "provider")).toBe(true)
        expect(JSON.stringify(payload.parts)).toContain("https://tanstack.com/")
        const history = projectChatModelHistory(
          [{ id: "saved", role: "assistant", state: "complete", payload }],
          { providerId: model.providerId, protocol: model.api, modelId: model.modelId },
        )
        const chunks: StreamChunk[] = []
        for await (const chunk of chat({
          adapter: createChatAdapter(model, true),
          tools: chatWebTools(model, true, []),
          messages: [
            ...history,
            {
              role: "user",
              content:
                "Based on that evidence, explain the difference between provider tools and function tools in one sentence.",
            },
          ],
        }))
          chunks.push(chunk)
        expect(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(false)
        expect(chunks.some((chunk) => chunk.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(true)
      }
    },
    360_000,
  )
  test.each(["openai", "anthropic", "openrouter"] as const)(
    "%s saves native-only evidence without an application result slot",
    async (provider) => {
      const result = await nativeWebRun(provider)
      const payload = result.saved.at(-1)!
      const calls = payload.parts.filter((part) => part.type === "tool-call")
      expect(calls.length).toBeGreaterThan(0)
      expect(
        calls.every(
          (part) =>
            part.executionLocation === "provider" &&
            Array.isArray(part.targets) &&
            part.targets.length === 0,
        ),
      ).toBe(true)
      expect(result.executed).toBe(0)
      expect(result.results).toBe(0)
      expect(payload.parts.find((part) => part.type === "text")).toMatchObject({
        metadata: { web: { citations: [{ url: webTestSource.url, endIndex: 16 }] } },
      })
      expect(JSON.stringify(payload.parts)).not.toContain("opaque-")
      expect(JSON.stringify(result.chunks)).not.toContain("opaque-")
      expect(JSON.stringify(payload.provenance)).toContain("providerUsage")
      expect(result.requests[0]!.max_tool_calls).toBe(provider === "anthropic" ? undefined : 5)
      expect((payload.provenance?.usage as { cost?: number } | undefined)?.cost).toBe(
        provider === "openrouter" ? 0.012 : undefined,
      )
      const projected = projectChatModelHistory(
        [{ id: "saved", role: "assistant", state: "complete", payload }],
        {
          providerId: result.model.providerId,
          protocol: result.model.api,
          modelId: result.model.modelId,
        },
      )
      for await (const _chunk of chat({
        adapter: result.adapter,
        tools: result.tools,
        messages: [...projected, { role: "user", content: "Explain that evidence" }],
      })) {
        /* Consume the bounded follow-up. */
      }
      expect(JSON.stringify(result.requests[1]).includes("opaque-evidence")).toBe(
        provider === "anthropic",
      )
      expect(
        provider !== "openrouter" || JSON.stringify(result.requests[1]).includes('"annotations"'),
      ).toBe(true)
      expect(
        provider !== "openrouter" ||
          (result.requests[1]!.messages as { tool_calls?: unknown[] }[]).every(
            (message) => !message.tool_calls?.length,
          ),
      ).toBe(true)
      const portable = projectChatModelHistory(
        [{ id: "saved", role: "assistant", state: "complete", payload }],
        { providerId: "other", protocol: result.model.api, modelId: result.model.modelId },
      )
      expect(JSON.stringify(portable)).toContain(webTestSource.url)
      expect(JSON.stringify(portable)).not.toContain("opaque-")
      expect(
        portable.some((message) =>
          message.toolCalls?.some((call) => call.function.name === "web_search"),
        ),
      ).toBe(false)
    },
  )

  test("Anthropic resumes pause_turn with unchanged server evidence and sums request usage", async () => {
    const result = await nativeWebRun("anthropic", { pause: true })
    expect(result.requests).toHaveLength(2)
    expect(JSON.stringify(result.requests[1])).toContain("opaque-evidence")
    expect(result.chunks.filter((chunk) => chunk.type === EventType.RUN_FINISHED)).toHaveLength(1)
    expect(result.saved.at(-1)!.provenance?.usage).toMatchObject({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    })
    const citations = result.saved
      .at(-1)!
      .parts.filter((part) => part.type === "text")
      .flatMap(
        (part) => (part.metadata as { web: { citations: { endIndex: number }[] } }).web.citations,
      )
    expect(citations).toHaveLength(2)
  })

  test("mixed native and application calls execute only the application call", async () => {
    const result = await nativeWebRun("anthropic", { application: true })
    expect(result.executed).toBe(1)
    expect(result.results).toBe(1)
    expect(result.requests).toHaveLength(2)
    expect(
      result.saved.some((payload) =>
        payload.parts.some((part) => part.executionLocation === "provider"),
      ),
    ).toBe(true)
  })

  test("a server-tool error in a successful HTTP response is saved as failed activity", async () => {
    const result = await nativeWebRun("anthropic", { failure: true })
    expect(result.saved.at(-1)!.parts.find((part) => part.type === "tool-call")).toMatchObject({
      executionLocation: "provider",
      state: "error",
      targets: [],
    })
  })

  test("disabled access declares no native tools and enabled access rejects protocol and name collisions", () => {
    const model = { providerType: "openai", api: "chat-completions" } as ChatModelConfiguration
    expect(chatWebTools(model, false, [{ name: "web_search" }])).toEqual([])
    expect(() => chatWebTools(model, true, [])).toThrow("Select Responses")
    expect(() =>
      chatWebTools({ ...model, api: "responses" }, true, [{ name: "web_fetch" }]),
    ).toThrow("reserved")
    expect(() =>
      chatWebTools({ ...model, api: "responses", modelId: "gpt-audio" }, true, []),
    ).toThrow("does not support")
  })

  test("Anthropic continuations exhaust the model-turn budget without retrying another provider", async () => {
    let requests = 0
    const model: ChatModelConfiguration = {
      providerId: "configured-instance",
      providerType: "anthropic",
      api: "anthropic-messages",
      providerName: "Anthropic",
      modelId: "test-model",
      apiKey: "synthetic-secret",
      baseUrl: "https://provider.example/v1",
      fetch: () => {
        requests++
        return Promise.resolve(nativeWebFixture("anthropic", true))
      },
    }
    const adapter = createChatAdapter(model, true)
    const chunks: StreamChunk[] = []
    for await (const chunk of chat({
      adapter,
      messages: [{ role: "user", content: "Search" }],
      tools: chatWebTools(model, true, []),
    })) {
      chunks.push(chunk)
    }
    expect(chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)).toMatchObject({
      code: "web_continuation_limit",
      usage: { promptTokens: 250, completionTokens: 125, totalTokens: 375 },
    })
    expect(requests).toBe(25)
  })

  test("the OpenRouter adapter preserves inline documents, configured URLs, and guarded credentials", async () => {
    let body: Record<string, unknown> | undefined
    const model: ChatModelConfiguration = {
      providerId: "configured-instance",
      providerType: "openrouter",
      providerName: "OpenRouter",
      api: "chat-completions",
      modelId: "custom-model",
      apiKey: "synthetic-secret",
      baseUrl: "https://provider.example/api/v1",
      fetch: async (input, init) => {
        const request = new Request(input, init)
        expect(request.url).toBe("https://provider.example/api/v1/chat/completions")
        expect(request.headers.get("Authorization")).toBe("Bearer synthetic-secret")
        body = JSON.parse(await request.text()) as Record<string, unknown>
        return nativeWebFixture("openrouter")
      },
    }
    for await (const _chunk of chat({
      adapter: createChatAdapter(model, true),
      tools: chatWebTools(model, true, []),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", content: "Read this document" },
            {
              type: "document",
              source: { type: "data", value: "JVBERg==", mimeType: "application/pdf" },
              metadata: { filename: "notes.pdf" },
            },
          ],
        },
      ],
    })) {
      /* Consume the adapter's document request. */
    }
    expect(JSON.stringify(body)).toContain('"file_data":"data:application/pdf;base64,JVBERg=="')
    expect(JSON.stringify(body)).not.toContain("[Attached document]")
  })

  test("an unknown model's web rejection becomes a safe configuration error without retry", async () => {
    let requests = 0
    const model: ChatModelConfiguration = {
      providerId: "configured-instance",
      providerType: "openai",
      providerName: "OpenAI",
      api: "responses",
      modelId: "custom-model",
      apiKey: "synthetic-secret",
      baseUrl: "https://provider.example/v1",
      fetch: () => {
        requests++
        return Promise.resolve(
          Response.json(
            {
              error: {
                type: "invalid_request_error",
                code: "invalid_request_error",
                message: "web_search rejected private-gateway synthetic-secret",
              },
            },
            { status: 400 },
          ),
        )
      },
    }
    const chunks: StreamChunk[] = []
    for await (const chunk of chat({
      adapter: createChatAdapter(model, true),
      tools: chatWebTools(model, true, []),
      messages: [{ role: "user", content: "Search" }],
    }))
      chunks.push(chunk)
    expect(requests).toBe(1)
    expect(chunks.find((chunk) => chunk.type === EventType.RUN_ERROR)).toMatchObject({
      code: "web_access_unavailable",
    })
    expect(JSON.stringify(chunks)).not.toContain("synthetic-secret")
  })

  test("cancellation reaches the guarded transport and prevents a pause continuation", async () => {
    const controller = new AbortController()
    let requests = 0
    const model: ChatModelConfiguration = {
      providerId: "configured-instance",
      providerType: "anthropic",
      api: "anthropic-messages",
      providerName: "Anthropic",
      modelId: "test-model",
      apiKey: "synthetic-secret",
      baseUrl: "https://provider.example/v1",
      fetch: (input, init) => {
        requests++
        expect(new Request(input, init).signal.aborted).toBe(false)
        controller.abort()
        return Promise.resolve(nativeWebFixture("anthropic", true))
      },
    }
    for await (const _chunk of chat({
      adapter: createChatAdapter(model, true),
      messages: [{ role: "user", content: "Search" }],
      tools: chatWebTools(model, true, []),
      abortController: controller,
    })) {
      /* Consume the cancellation. */
    }
    expect(requests).toBe(1)
  })
})
