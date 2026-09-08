import { Data } from "effect"

export class ChatError extends Data.TaggedError("ChatError")<{
  reason: "InvalidInput" | "NotFound" | "Unavailable"
  message: string
}> {}

export function chatError(reason: ChatError["reason"], message: string): ChatError {
  return new ChatError({ reason, message })
}
