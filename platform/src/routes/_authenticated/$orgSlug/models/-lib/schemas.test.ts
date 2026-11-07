import { Result, Schema } from "effect"
import { describe, expect, test } from "vitest"

import { strictParseOptions } from "@/lib/schemas"
import { SaveModelProviderInputSchema } from "./schemas"

const decodeModelProviderSave = Schema.decodeUnknownResult(
  SaveModelProviderInputSchema,
  strictParseOptions,
)

const modelProviderSaveFixture = {
  organizationSlug: "test-organization",
  id: null,
  lockVersion: null,
  name: "Provider",
  baseUrl: "https://provider.example/v1",
  apiKey: "test-key",
  models: [{ modelId: "anthropic/claude-sonnet-4.6", name: "Test model" }],
}

describe("model provider save boundary", () => {
  test.each([
    { providerType: "openai", api: "anthropic-messages" },
    { providerType: "anthropic", api: "responses" },
    { providerType: "openrouter", api: "responses" },
    { providerType: "unknown", api: "responses" },
    {
      providerType: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
    },
    {
      providerType: "google",
      api: "gemini-generate-content",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
    },
    { providerType: "xai", api: "chat-completions" },
  ])("rejects $providerType with $api after adding route fields", (protocol) => {
    expect(
      Result.isFailure(decodeModelProviderSave({ ...modelProviderSaveFixture, ...protocol })),
    ).toBe(true)
  })

  test.each([
    { providerType: "openai", api: "responses" },
    { providerType: "openai", api: "chat-completions" },
    { providerType: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
    { providerType: "openrouter", api: "chat-completions" },
    {
      providerType: "google",
      api: "gemini-generate-content",
      baseUrl: "https://generativelanguage.googleapis.com",
    },
    { providerType: "xai", api: "responses" },
  ])("accepts $providerType with $api", (protocol) => {
    expect(
      Result.isSuccess(decodeModelProviderSave({ ...modelProviderSaveFixture, ...protocol })),
    ).toBe(true)
  })
})
