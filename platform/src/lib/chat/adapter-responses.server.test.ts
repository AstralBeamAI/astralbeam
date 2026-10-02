import { chat } from "@tanstack/ai"
import { Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"

import { createChatAdapter } from "./adapter.server.ts"

const responsesRequestSchema = Schema.Struct({
  model: Schema.String,
  include: Schema.optionalKey(Schema.Array(Schema.String)),
})

afterEach(() => vi.unstubAllGlobals())

describe("OpenAI Responses compatibility", () => {
  test.each([
    { modelId: "gpt-5.6-terra", include: ["reasoning.encrypted_content"] },
    { modelId: "custom-deployment", include: undefined },
  ])("preserves native request semantics for $modelId", async ({ modelId, include }) => {
    const requests: (typeof responsesRequestSchema.Type)[] = []
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      if (typeof init.body !== "string") throw new Error("Expected a JSON request body")
      requests.push(Schema.decodeUnknownSync(responsesRequestSchema)(JSON.parse(init.body)))
      return Promise.resolve(
        Response.json({ error: { message: "Synthetic test response" } }, { status: 401 }),
      )
    })
    const adapter = createChatAdapter({
      providerId: "provider-instance",
      providerName: "Configured OpenAI",
      providerType: "openai",
      api: "responses",
      baseUrl: "https://openai.example/v1",
      apiKey: "configured-instance-key",
      modelId,
    })
    for await (const _event of chat({ adapter, messages: [{ role: "user", content: "Hello" }] })) {
      // Drain the run so the SDK maps and sends its request to the synthetic provider boundary.
    }
    expect(requests).toHaveLength(1)
    expect(requests[0]!.model).toBe(modelId)
    expect(requests[0]!.include).toEqual(include)
  })
})
