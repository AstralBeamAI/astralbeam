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
  test("accepts OpenRouter slash model IDs through Chat Completions", () => {
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "openrouter",
        api: "chat-completions",
        baseUrl: "https://openrouter.ai/api/v1",
        models: [{ modelId: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
      }),
    ).toBe(true)
  })

  test("rejects unsupported provider protocols and unknown providers", () => {
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
        providerType: "openrouter",
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
        baseUrl: "https://api.anthropic.com",
      }),
    ).toBe(true)
    expect(
      Schema.is(ModelProviderFieldsSchema)({
        ...modelProviderSchemaFixture,
        providerType: "anthropic",
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com/v1",
      }),
    ).toBe(false)
  })
})
