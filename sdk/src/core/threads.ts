import type { UIMessage } from "@tanstack/ai-client"
import { isSettledToolCall } from "./messages.ts"
import type { WebPartMetadata } from "./web.ts"
import type { JwtOptions } from "../api/api.ts"
import { listChatMessages, type ChatHistoryPageEncodedMessagesItem } from "../api/generated/api.ts"

/** A saved conversation visible to the signed-in tenant user. */
export interface ChatThread {
  id: string
  title: string | null
  agentId: string | null
  version: number
  role: "viewer" | "member" | "manager"
  writerActive: boolean
  hasMessages: boolean
  updatedAt: string
}

export interface ChatPendingInteraction {
  sourceMessageId: string
  sourcePartId: string
  responseTargetId: string
  toolCallId: string
  targetTenantUserId: string | null
  targetClientId: string | null
  executionLocation: string
}

export interface SavedMessageMetadata {
  state: "draft" | "complete" | "interrupted"
  authorTenantUserId: string | null
}

/** Application identities extend TanStack's tool part without replacing its provider identity. */
export type ChatToolCallPart = Extract<UIMessage["parts"][number], { type: "tool-call" }> & {
  metadata?: WebPartMetadata
  executionLocation?: "server_api" | "sandbox" | "browser" | "provider"
  upstreamToolCallId?: string
  applicationPartId?: string
  sourceMessageId?: string
  responseTargetId?: string
  widgetRenderId?: string
  resultOutcome?: "succeeded" | "failed" | "skipped" | "unknown"
}

export type ChatTextPart = Extract<UIMessage["parts"][number], { type: "text" }> & {
  metadata?: WebPartMetadata
}

export function newUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function threadFromRecord(
  record: {
    id: string
    title: string | null
    agent_id: string | null
    version: number
    role: "viewer" | "member" | "manager"
    writer_active: boolean
    updated_at: string
  },
  hasMessages = true,
): ChatThread {
  return {
    id: record.id,
    title: record.title,
    agentId: record.agent_id,
    version: record.version,
    role: record.role,
    writerActive: record.writer_active,
    hasMessages,
    updatedAt: record.updated_at,
  }
}

export function savedToolCallId(messageId: string, partId: string, targetId?: string | null) {
  return `saved:${messageId}:${partId}${targetId ? `:${targetId}` : ""}`
}

export async function loadThreadMessages(
  id: string,
  options: JwtOptions,
  pageAfter?: string,
  liveToolMessageIds: ReadonlyMap<string, string> = new Map(),
) {
  const page = await listChatMessages(
    id,
    { page_size: 100, ...(pageAfter ? { page_after: pageAfter } : {}) },
    options,
  )
  const pendingInteractions: ChatPendingInteraction[] = page.pending_interactions.map(
    (pending) => ({
      sourceMessageId: pending.source_message_id,
      sourcePartId: pending.source_part_id,
      responseTargetId: pending.response_target_id,
      toolCallId:
        liveToolMessageIds.get(pending.tool_call_id) === pending.source_message_id
          ? pending.tool_call_id
          : savedToolCallId(
              pending.source_message_id,
              pending.source_part_id,
              pending.response_target_id,
            ),
      targetTenantUserId: pending.target_tenant_user_id,
      targetClientId: pending.target_client_id,
      executionLocation: pending.execution_location,
    }),
  )
  return {
    ...page,
    pendingInteractions,
  }
}

export function projectThreadMessages(
  records: readonly ChatHistoryPageEncodedMessagesItem[],
  pendingInteractions: readonly ChatPendingInteraction[] = [],
  liveToolMessageIds: ReadonlyMap<string, string> = new Map(),
) {
  const messages: UIMessage[] = []
  const calls = new Map<string, ChatToolCallPart>()
  for (const message of records) {
    if (message.role === "tool") {
      for (const part of message.parts) {
        const call = calls.get(
          savedToolCallId(
            message.source_assistant_message_id!,
            message.source_tool_part_id!,
            message.response_target_id,
          ),
        )
        if (!call) continue
        call.output = part.output ?? null
        Object.assign(call, { resultOutcome: part.outcome })
        call.state = part.outcome === "succeeded" ? "complete" : "error"
      }
      continue
    }
    const parts = message.parts.flatMap((part) => {
      const source = part.source
      if (
        (part.type === "image" || part.type === "document") &&
        source &&
        typeof source === "object" &&
        !Array.isArray(source) &&
        "type" in source &&
        source.type === "attachment"
      )
        return [
          {
            ...part,
            source: { ...source, type: "url", value: "" },
            savedAttachmentId: part.id,
          },
        ]
      if (part.type !== "tool-call") return [part]
      const toolCallId = String(part.toolCallId)
      const targets = Array.isArray(part.targets)
        ? part.targets.flatMap((target: unknown) =>
            target &&
            typeof target === "object" &&
            !Array.isArray(target) &&
            "id" in target &&
            typeof target.id === "string"
              ? [target.id]
              : [],
          )
        : pendingInteractions
            .filter(
              (pending) =>
                pending.sourceMessageId === message.id && pending.sourcePartId === part.id,
            )
            .map((pending) => pending.responseTargetId)
      return (targets.length ? targets : [undefined]).map((responseTargetId) => {
        const savedId = savedToolCallId(message.id, String(part.id), responseTargetId)
        const call = {
          ...part,
          id:
            part.executionLocation === "provider"
              ? part.id
              : liveToolMessageIds.get(toolCallId) === message.id
                ? toolCallId
                : savedId,
          upstreamToolCallId: toolCallId,
          applicationPartId: part.id,
          sourceMessageId: message.id,
          responseTargetId,
        } as unknown as ChatToolCallPart
        calls.set(savedId, call)
        return call
      })
    }) as UIMessage["parts"]
    messages.push({
      id: message.id,
      role: message.role,
      parts,
      createdAt: new Date(message.created_at),
      metadata: {
        astralbeam: {
          state: message.state,
          authorTenantUserId: message.author_tenant_user_id,
        } satisfies SavedMessageMetadata,
      },
    })
  }
  const completed = new Map(
    messages
      .flatMap((message) => message.parts)
      .filter(
        (part) =>
          part.type === "tool-call" &&
          (part as ChatToolCallPart).executionLocation === "provider" &&
          (part.state === "complete" || part.state === "error"),
      )
      .map((part) => [(part as ChatToolCallPart).upstreamToolCallId, part as ChatToolCallPart]),
  )
  for (const message of messages)
    for (const part of message.parts) {
      if (
        part.type !== "tool-call" ||
        (part as ChatToolCallPart).executionLocation !== "provider" ||
        isSettledToolCall(part)
      )
        continue
      const result = completed.get((part as ChatToolCallPart).upstreamToolCallId)
      if (result) {
        part.state = result.state
        part.output = result.state === "error" ? (result.output as unknown) : { sources: [] }
      }
    }
  return messages
}

/** Cache selection within this tab. Stored IDs are reauthorized before loading history. */
export function selectedThread(key: string, id?: string | null): string | undefined {
  try {
    if (id === undefined) return globalThis.sessionStorage?.getItem(key) ?? undefined
    if (id === null) globalThis.sessionStorage?.removeItem(key)
    else globalThis.sessionStorage?.setItem(key, id)
  } catch {
    // Storage may be disabled by the embedding host or browser privacy settings.
  }
  return undefined
}
