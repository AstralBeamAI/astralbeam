import { expect, it } from "vitest"
import { modelWebCapabilities } from "./web-capabilities.server"

it.each([
  ["openai", "responses", "gpt-5.6-terra", undefined, true],
  ["openai", "chat-completions", "gpt-5.6-terra", undefined, false],
  ["openai", "responses", "gpt-3.5-turbo", undefined, false],
  ["openai", "responses", "custom-model", undefined, null],
  ["openrouter", "chat-completions", "custom/model", undefined, true],
  ["openai", "responses", "gpt-5.6-terra", "https://gateway.example/v1", null],
  ["anthropic", "anthropic-messages", "claude-sonnet-4-6", undefined, true],
  ["anthropic", "anthropic-messages", "claude-opus-5-fast", undefined, false],
] as const)(
  "classifies %s %s %s for creation defaults",
  (providerType, api, modelId, baseUrl, available) => {
    expect(
      modelWebCapabilities({ providerType, api, modelId, ...(baseUrl ? { baseUrl } : {}) }),
    ).toMatchObject({ available })
  },
)
