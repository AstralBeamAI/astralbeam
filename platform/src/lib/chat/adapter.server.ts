import { OpenAITextAdapter } from "@tanstack/ai-openai"

/** Model every chat run streams from. */
const CHAT_MODEL = "gpt-5.6-terra"

export function createChatAdapter(apiKey: string) {
  return new OpenAITextAdapter({ apiKey }, CHAT_MODEL)
}
