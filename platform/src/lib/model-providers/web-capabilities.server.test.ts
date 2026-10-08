import { expect, it } from "vitest"
import { modelWebCapabilities } from "./web-capabilities.server"

it.each([
  { providerType: "openai", api: "responses", modelId: "gpt-5.6-terra", available: true },
  { providerType: "openai", api: "chat-completions", modelId: "gpt-5.6-terra", available: false },
  { providerType: "openai", api: "responses", modelId: "gpt-3.5-turbo", available: false },
  { providerType: "openai", api: "responses", modelId: "custom-model", available: null },
  { providerType: "openrouter", api: "chat-completions", modelId: "custom/model", available: true },
  {
    providerType: "anthropic",
    api: "anthropic-messages",
    modelId: "custom-model",
    available: null,
  },
] as const)(
  "classifies $providerType $api $modelId for creation defaults",
  ({ available, ...model }) => {
    expect(modelWebCapabilities(model).available).toBe(available)
  },
)
