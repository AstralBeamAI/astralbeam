import { expect, test } from "vitest"
import { modelWebCapabilities } from "./web-capabilities.server"

test.each([
  ["openai/gpt-4o", true],
  ["custom-model", null],
] as const)("OpenRouter creation default for %s is %s", (modelId, available) => {
  expect(
    modelWebCapabilities({ providerType: "openrouter", api: "chat-completions", modelId }),
  ).toEqual({ available, reason: null })
})
