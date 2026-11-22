import { chat, type AnyTextAdapter, type TokenUsage } from "@tanstack/ai"
import { OpenAITextAdapter } from "@tanstack/ai-openai"
import { Schema } from "effect"
import { describe, expect, test, vi } from "vitest"

import { createChatAdapter } from "./adapter.ts"

const responsesRequestSchema = Schema.Struct({
  model: Schema.String,
  include: Schema.optionalKey(Schema.Array(Schema.String)),
})

describe("OpenAI Responses compatibility", () => {
  test.each([
    { modelId: "gpt-6.1-sol", include: ["reasoning.encrypted_content"] },
    { modelId: "custom-deployment", include: undefined },
  ])("preserves native request semantics for $modelId", async ({ modelId, include }) => {
    const requests: (typeof responsesRequestSchema.Type)[] = []
    const responsesFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (
      _input,
      init,
    ) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
      requests.push(Schema.decodeUnknownSync(responsesRequestSchema)(JSON.parse(init.body)))
      return Promise.resolve(
        Response.json({ error: { message: "Synthetic test response" } }, { status: 401 }),
      )
    }
    const adapter = createChatAdapter({
      providerId: "provider-instance",
      providerName: "Configured OpenAI",
      providerType: "openai",
      api: "responses",
      baseUrl: "https://openai.example/v1",
      apiKey: "configured-instance-key",
      modelId,
      fetch: responsesFetch,
    })
    for await (const _event of chat({
      threadId: "provider-test",
      adapter,
      messages: [{ role: "user", content: "Hello" }],
    })) {
      // Drain the run so the SDK maps and sends its request to the synthetic provider boundary.
    }
    expect(requests).toHaveLength(1)
    expect(requests[0]!.model).toBe(modelId)
    expect(requests[0]!.include).toEqual(include)
  })

  test("uses only the transport to account for OpenAI compaction", async () => {
    const usage: TokenUsage = {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      promptTokensDetails: { cachedTokens: 20 },
    }
    const record = vi.fn(async (_usage: TokenUsage) => {})
    const compact = vi.spyOn(OpenAITextAdapter.prototype, "compact")
    try {
      const adapter: AnyTextAdapter = createChatAdapter(
        {
          providerId: "provider-instance",
          providerName: "Configured OpenAI",
          providerType: "openai",
          api: "responses",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "configured-instance-key",
          modelId: "gpt-6.1-sol",
          fetch: () =>
            Promise.resolve(
              Response.json({
                output: [{ type: "compaction", id: "compact", encrypted_content: "signed-state" }],
                usage: {
                  input_tokens: 100,
                  output_tokens: 10,
                  input_tokens_details: { cached_tokens: 20 },
                },
              }),
            ),
        },
        record,
      )
      await adapter.compact!({
        model: "gpt-6.1-sol",
        messages: [{ role: "user", content: "Hello" }],
        addUsage: (value) => void record(value),
      })
      expect(record).toHaveBeenCalledExactlyOnceWith(usage)
      expect(compact.mock.calls[0]![0]).not.toHaveProperty("addUsage")
    } finally {
      compact.mockRestore()
    }
  })
})
