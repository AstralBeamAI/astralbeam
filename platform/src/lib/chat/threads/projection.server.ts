import { convertMessagesToModelMessages, type ModelMessage, type UIMessage } from "@tanstack/ai"
import { Schema } from "effect"

import type { ChatMessagePayload } from "./schemas"

interface ChatProjectionRecord {
  readonly id: string
  readonly role: "user" | "assistant" | "tool"
  readonly state: "draft" | "complete" | "interrupted"
  readonly payload: Omit<ChatMessagePayload, "version"> & { readonly version: number }
  readonly sourceAssistantMessageId?: string | null
  readonly sourceToolPartId?: string | null
  readonly responseTargetId?: string | null
}

interface ChatProjectionTarget {
  readonly providerId: string
  readonly protocol: string
  readonly modelId: string
}

export function chatStoredJson(value: unknown): typeof Schema.JsonObject.Type {
  return Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse(JSON.stringify(value)))
}

function portableChatPart(part: typeof Schema.JsonObject.Type): (typeof Schema.JsonObject.Type)[] {
  switch (part.type) {
    case "text":
      return [{ type: "text", content: Schema.decodeUnknownSync(Schema.String)(part.content) }]
    case "image":
    case "audio":
    case "video":
    case "document": {
      const source = Schema.decodeUnknownSync(Schema.JsonObject)(part.source)
      if (source.type === "file") throw new Error("Provider file handles require original media")
      const metadata = Schema.is(Schema.JsonObject)(part.metadata) ? part.metadata : undefined
      return [
        {
          type: part.type,
          source: { ...source },
          ...(typeof metadata?.filename === "string"
            ? { metadata: { filename: metadata.filename } }
            : {}),
        },
      ]
    }
    case "tool-call": {
      const metadata = Schema.is(Schema.JsonObject)(part.metadata) ? part.metadata : undefined
      if (metadata?.providerExecuted === true) return []
      return [
        {
          type: "tool-call",
          id: Schema.decodeUnknownSync(Schema.String)(part.toolCallId),
          name: Schema.decodeUnknownSync(Schema.String)(part.name),
          arguments: Schema.decodeUnknownSync(Schema.String)(part.arguments),
          state: "input-complete",
        },
      ]
    }
    case "structured-output":
      return part.status === "complete"
        ? [{ type: "text", content: part.raw || JSON.stringify(part.data ?? null) }]
        : []
    default:
      return []
  }
}

function completeChatExchanges(records: readonly ChatProjectionRecord[]): ChatProjectionRecord[] {
  const results = new Map<string, ChatProjectionRecord>()
  for (const record of records) {
    if (record.role === "tool" && record.state === "complete")
      results.set(
        JSON.stringify([
          record.sourceAssistantMessageId,
          record.sourceToolPartId,
          record.responseTargetId,
        ]),
        record,
      )
  }
  return records.flatMap((record) => {
    if (record.role === "tool" || record.state !== "complete") return []
    const outputs: ChatProjectionRecord[] = []
    const missing: Schema.JsonObject[] = []
    for (const part of record.payload.parts) {
      if (part.type !== "tool-call" || !Array.isArray(part.targets)) continue
      const targets = (part.targets as readonly Schema.Json[])
        .map((item) => Schema.decodeUnknownSync(Schema.JsonObject)(item))
        .sort((a, b) =>
          Schema.decodeUnknownSync(Schema.String)(a.id).localeCompare(
            Schema.decodeUnknownSync(Schema.String)(b.id),
          ),
        )
      const accepted = targets.map((recipient) =>
        results.get(JSON.stringify([record.id, part.id, recipient.id])),
      )
      if (accepted.some((result) => !result)) {
        missing.push({
          tool: part.name!,
          arguments: part.arguments!,
          responses: targets.map((recipient, index) => ({
            recipient,
            result: accepted[index]?.payload.parts[0] ?? null,
          })),
        })
        continue
      }
      if (accepted.length === 1) outputs.push(accepted[0]!)
      else {
        const first = accepted[0]!
        const output = targets.map((recipient, index) => ({
          responseTargetId: recipient.id!,
          ...(recipient.tenantUserId ? { tenantUserId: recipient.tenantUserId } : {}),
          ...(recipient.clientId ? { clientId: recipient.clientId } : {}),
          outcome: accepted[index]!.payload.parts[0]!.outcome!,
          output: accepted[index]!.payload.parts[0]!.output ?? null,
        }))
        outputs.push({
          ...first,
          payload: {
            version: 1,
            parts: [
              {
                id: first.payload.parts[0]!.id,
                type: "tool-result",
                toolCallId: part.toolCallId!,
                output,
                content: JSON.stringify(output),
              },
            ],
          },
        })
      }
    }
    if (missing.length > 0) {
      // An incomplete exchange is context, never an executable or unmatched provider tool call.
      const visible = record.payload.parts.filter((part) => part.type !== "tool-call")
      const settled = outputs.map((result) => result.payload.parts[0]!)
      return [
        {
          ...record,
          payload: {
            version: 1,
            parts: [
              ...visible,
              {
                id: `${record.id}:waiting`,
                type: "text",
                content: `Saved tool activity awaiting confirmation: ${JSON.stringify({ pending: missing, accepted: settled })}`,
              },
            ],
          },
        },
      ]
    }
    return [record, ...outputs]
  })
}

/** Opaque provider context is reusable only with the provider instance, protocol and model that produced it. */
export function projectChatModelHistory(
  records: readonly ChatProjectionRecord[],
  target?: ChatProjectionTarget,
): ModelMessage[] {
  for (const record of records) {
    if (record.payload.version !== 1) throw new Error("Unsupported conversation payload version")
  }
  return completeChatExchanges(records).flatMap((record) => {
    const provenance = record.payload.provenance
    const compatible =
      target !== undefined &&
      provenance?.providerId === target.providerId &&
      provenance.protocol === target.protocol &&
      provenance.modelId === target.modelId
    let messages: ModelMessage[]
    if (compatible && record.payload.modelMessages) {
      messages = structuredClone(record.payload.modelMessages).map((message) => ({
        ...message,
        ...(typeof message.createdAt === "string"
          ? { createdAt: new Date(message.createdAt) }
          : {}),
      })) as unknown as ModelMessage[]
    } else if (record.role === "tool") {
      messages = record.payload.parts.map((part) => ({
        id: Schema.decodeUnknownSync(Schema.String)(part.id),
        role: "tool" as const,
        toolCallId: Schema.decodeUnknownSync(Schema.String)(part.toolCallId),
        content:
          typeof part.content === "string" ? part.content : JSON.stringify(part.output ?? null),
      }))
    } else {
      const parts = record.payload.parts.flatMap((part) =>
        portableChatPart(part).map((portable) => ({ id: part.id, portable })),
      )
      if (parts.length === 0) return []
      messages = convertMessagesToModelMessages([
        {
          id: Schema.decodeUnknownSync(Schema.String)(parts[0]!.id),
          role: record.role,
          parts: parts.map((part) => part.portable),
        } as unknown as UIMessage,
      ])
    }
    const identities = new Map<string | undefined, number>()
    for (const message of messages) {
      identities.set(message.id, (identities.get(message.id) ?? 0) + 1)
    }
    return messages.map((message, index) => {
      // Native model records can repeat upstream IDs. Canonical part IDs keep expansions distinct.
      const id =
        message.id && identities.get(message.id) === 1
          ? message.id
          : Schema.decodeUnknownSync(Schema.String)(record.payload.parts[index]?.id)
      return {
        ...message,
        id: `${record.id}:${id}`,
        metadata: { ...message.metadata, astralbeam: { messageId: record.id } },
      }
    })
  })
}
