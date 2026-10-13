import { chat, EventType } from "@tanstack/ai"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"

import { createChatAdapter } from "./adapter.ts"

const responsesRequestSchema = Schema.Struct({
  model: Schema.String,
  include: Schema.optionalKey(Schema.Array(Schema.String)),
})

describe("OpenAI Responses compatibility", () => {
  test.each([
    {
      reason: "max_output_tokens",
      terminal: {
        type: EventType.RUN_FINISHED,
        metadata: { tanstack: { finishReason: "length" } },
      },
      errors: 0,
    },
    {
      reason: "content_filter",
      terminal: { type: EventType.RUN_ERROR, code: "incomplete" },
      errors: 1,
    },
  ])("handles an incomplete response caused by %s", async ({ reason, terminal, errors }) => {
    const adapter = createChatAdapter({
      providerId: "provider-instance",
      providerName: "Configured OpenAI",
      providerType: "openai",
      api: "responses",
      baseUrl: "https://openai.example/v1",
      apiKey: "synthetic-key",
      modelId: "custom-deployment",
      outputCap: 32,
      fetch: () =>
        Promise.resolve(
          new Response(
            `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Partial answer"}\n\nevent: response.incomplete\ndata: ${JSON.stringify({ type: "response.incomplete", response: { id: "r1", status: "incomplete", output: [], incomplete_details: { reason } } })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    })
    const events = []
    for await (const event of chat({ adapter, messages: [{ role: "user", content: "Hello" }] }))
      events.push(event)
    expect(events).toContainEqual(
      expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT", delta: "Partial answer" }),
    )
    expect(events.filter((event) => event.type === EventType.RUN_ERROR)).toHaveLength(errors)
    expect(events).toContainEqual(expect.objectContaining(terminal))
  })
  test.each([
    { modelId: "gpt-5.6-terra", include: ["reasoning.encrypted_content"] },
    { modelId: "custom-deployment", include: undefined },
  ])("preserves native request semantics for $modelId", async ({ modelId, include }) => {
    const requests: (typeof responsesRequestSchema.Type)[] = []
    const responsesFetch: typeof fetch = (_input, init) => {
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
      outputCap: 4096,
      fetch: responsesFetch,
    })
    for await (const _event of chat({ adapter, messages: [{ role: "user", content: "Hello" }] })) {
      // Drain the run so the SDK maps and sends its request to the synthetic provider boundary.
    }
    expect(requests).toHaveLength(1)
    expect(requests[0]!.model).toBe(modelId)
    expect(requests[0]!.include).toEqual(include)
  })
})
