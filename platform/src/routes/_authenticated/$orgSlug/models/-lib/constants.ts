import type { ModelProviderApi, ModelProviderType } from "@/lib/model-providers/schemas"

export const modelProviderDescriptors: Record<
  ModelProviderType,
  {
    label: string
    baseUrl: string
    api: ModelProviderApi
  }
> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", api: "responses" },
  anthropic: {
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "chat-completions",
  },
}

export const modelProviderApiItems = [
  { label: "Responses", value: "responses" },
  { label: "Chat Completions", value: "chat-completions" },
] satisfies { label: string; value: ModelProviderApi }[]
