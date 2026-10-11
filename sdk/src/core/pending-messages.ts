import type { MultimodalContent } from "@tanstack/ai-client"

export interface PendingChatMessage {
  id: string
  content: string | MultimodalContent
  mode: "queue" | "steer"
  status: "queued" | "sending" | "accepted"
  attachmentsRequired: boolean
  steeringFallback?: boolean | undefined
  turnMessageId?: string | undefined
  acceptedMessageId?: string | undefined
  tools?: Array<Record<string, unknown>> | undefined
}

export function pendingMessageText(content: string | MultimodalContent): string {
  const parts = typeof content === "string" ? content : content.content
  return typeof parts === "string"
    ? parts
    : parts.flatMap((part) => (part.type === "text" ? [part.content] : [])).join("\n")
}

export function storePendingMessages(
  key: string | undefined,
  messages: readonly PendingChatMessage[],
): void {
  if (!key) return
  try {
    if (messages.length === 0) globalThis.sessionStorage?.removeItem(key)
    else
      globalThis.sessionStorage?.setItem(
        key,
        JSON.stringify(
          messages.map((message) => ({
            ...message,
            content:
              typeof message.content === "string" || typeof message.content.content === "string"
                ? message.content
                : { content: message.content.content.filter((part) => part.type === "text") },
            attachmentsRequired:
              message.attachmentsRequired ||
              (typeof message.content !== "string" &&
                typeof message.content.content !== "string" &&
                message.content.content.some((part) => part.type !== "text")),
          })),
        ),
      )
  } catch {
    // Storage can be unavailable in embedded host pages. The mounted session retains its inputs.
  }
}

export function loadPendingMessages(key: string | undefined): PendingChatMessage[] {
  if (!key) return []
  try {
    const stored: unknown = JSON.parse(globalThis.sessionStorage?.getItem(key) ?? "[]")
    if (!Array.isArray(stored)) return []
    return stored.filter((value: unknown): value is PendingChatMessage => {
      if (value === null || typeof value !== "object") return false
      const entry = value as Record<string, unknown>
      const content = entry.content as string | { content?: unknown } | null
      const parts = typeof content === "string" ? content : content?.content
      return (
        typeof entry.id === "string" &&
        (typeof parts === "string" ||
          (Array.isArray(parts) &&
            parts.every((value: unknown) => {
              const part = value as { type?: unknown; content?: unknown } | null
              return part?.type === "text" && typeof part.content === "string"
            }))) &&
        (entry.mode === "queue" || entry.mode === "steer") &&
        (entry.status === "queued" || entry.status === "sending" || entry.status === "accepted") &&
        typeof entry.attachmentsRequired === "boolean" &&
        (entry.steeringFallback === undefined || typeof entry.steeringFallback === "boolean") &&
        [entry.turnMessageId, entry.acceptedMessageId].every(
          (id) => id === undefined || typeof id === "string",
        ) &&
        (entry.tools === undefined ||
          (Array.isArray(entry.tools) &&
            entry.tools.every(
              (tool: unknown) => tool !== null && typeof tool === "object" && !Array.isArray(tool),
            )))
      )
    })
  } catch {
    return []
  }
}
