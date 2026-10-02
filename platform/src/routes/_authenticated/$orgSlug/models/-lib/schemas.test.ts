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
  models: [{ modelId: "test-model", name: "Test model" }],
}

describe("model provider save boundary", () => {
  test.each([
    { providerType: "openai", api: "anthropic-messages" },
    { providerType: "anthropic", api: "responses" },
    { providerType: "openrouter", api: "responses" },
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
  ])("accepts $providerType with $api", (protocol) => {
    expect(
      Result.isSuccess(decodeModelProviderSave({ ...modelProviderSaveFixture, ...protocol })),
    ).toBe(true)
  })
})
