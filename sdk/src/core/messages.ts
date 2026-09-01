import type { UIMessage } from "@tanstack/ai-client"
import { ASK_QUESTIONNAIRE_TOOL } from "./protocol.ts"

// A tool may legitimately resolve with a null output, so "settled" checks the state
// too; an output-only check would read such a call as still running.
export function isSettledToolCall(part: { state: string; output?: unknown }): boolean {
  return part.state === "complete" || part.state === "error" || part.output !== undefined
}

// A busy stream can be silent for a while (server-side reasoning, follow-ups after tool
// results), so a "Thinking…" affordance shows until the newest assistant part visibly
// makes progress.
export function lastPartInProgress(messages: UIMessage[]): boolean {
  const lastMessage = messages.at(-1)
  const lastPart = lastMessage?.role === "assistant" ? lastMessage.parts.at(-1) : undefined
  return lastPart != null && (
    ((lastPart.type === "text" || lastPart.type === "thinking") &&
      lastPart.content.length > 0) ||
    (lastPart.type === "tool-call" && !isSettledToolCall(lastPart))
  )
}

// Host tools execute between runs with status "ready". A send in that window ships their
// call unresolved: the endpoint re-offers the pending tool instead of calling the model,
// the message goes unanswered, and the redelivered call can re-execute a side-effecting
// tool — so those windows count as busy too. Questionnaires and calls to tools this mount
// never implemented stay interactive: the pre-send settle resolves them.
export function hasPendingToolRun(
  messages: UIMessage[],
  toolNames: ReadonlySet<string>,
): boolean {
  return messages.some((message) =>
    message.parts.some((part) =>
      part.type === "tool-call" && !isSettledToolCall(part) &&
      part.name !== ASK_QUESTIONNAIRE_TOOL && toolNames.has(part.name)
    )
  )
}
