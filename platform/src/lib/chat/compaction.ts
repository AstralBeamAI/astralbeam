import type { ModelMessage } from "@tanstack/ai"
import { Schema } from "effect"
import type { MessageRecord } from "./threads/threads"

export class ChatCompactionError extends Schema.TaggedError<ChatCompactionError>()(
  "ChatCompactionError",
  {
    code: Schema.Literals([
      "compaction_context_full",
      "compaction_instructions",
      "compaction_failed",
      "compaction_usage_limit",
      "compaction_limits",
    ]),
  },
) {}

export const ChatCompactionPayloadSchema = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literals(["portable", "native"]),
  messages: Schema.Array(Schema.JsonObject),
})

export function chatCompactionMessages(payload: typeof ChatCompactionPayloadSchema.Type) {
  return structuredClone(payload.messages) as unknown as ModelMessage[]
}

// Only settled prefixes are immutable. Wait for every response target, including interleaved calls.
export function chatCompactionBoundaries(
  history: readonly Pick<
    MessageRecord,
    "id" | "role" | "state" | "turnMessageId" | "responseTargetId" | "payload"
  >[],
) {
  const pending = new Set<string>()
  const unanswered = new Set<string>()
  const boundaries: number[] = []
  for (const [index, message] of history.entries()) {
    if (message.state !== "complete") break
    if (message.role === "user") unanswered.add(message.id)
    if (message.role === "assistant" && message.turnMessageId)
      unanswered.delete(message.turnMessageId)
    for (const part of message.payload.parts) {
      if (part.type !== "tool-call" || !Array.isArray(part.targets)) continue
      for (const target of part.targets as readonly Schema.Json[]) {
        if (Schema.is(Schema.JsonObject)(target) && typeof target.id === "string")
          pending.add(target.id)
      }
    }
    if (message.responseTargetId) pending.delete(message.responseTargetId)
    if (!pending.size && !unanswered.size) boundaries.push(index)
  }
  return boundaries
}
