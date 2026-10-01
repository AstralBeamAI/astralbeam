import { Schema } from "effect"
import { describe, expect, test } from "vitest"

import { ModelProviderFieldsSchema } from "./schemas.ts"

const modelProviderSchemaFixture = {
  name: "Provider",
  providerType: "openai",
  api: "responses",
  baseUrl: "https://api.example/v1",
  apiKey: "provider-key",
  models: [{ modelId: "custom-model", name: "Custom" }],
}

describe("model provider protocols", () => {
  test("accepts mixed protocol models for one OpenCode instance", () => {
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "opencode",
        models: [
          { modelId: "gpt", name: "GPT", api: "responses" },
          { modelId: "claude", name: "Claude", api: "anthropic-messages" },
          { modelId: "deepseek", name: "DeepSeek", api: "chat-completions" },
        ],
      }),
    ).toBe(true)
  })

  test("rejects native provider protocol mismatches and unknown providers", () => {
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "anthropic",
      }),
    ).toBe(false)
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        api: "anthropic-messages",
      }),
    ).toBe(false)
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        models: [{ modelId: "claude", name: "Claude", api: "anthropic-messages" }],
      }),
    ).toBe(false)
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "unknown",
      }),
    ).toBe(false)
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "anthropic",
        api: "anthropic-messages",
        models: [{ modelId: "claude", name: "Claude", api: null }],
      }),
    ).toBe(true)
  })
})
