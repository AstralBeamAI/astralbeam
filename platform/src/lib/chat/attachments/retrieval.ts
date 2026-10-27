import type { ContentPart, ModelMessage } from "@tanstack/ai"
import { Schema } from "effect"

import { APP_HANDLE } from "@/lib/constants"
import type { ChatProjectionRecord } from "../threads/projection"
import { CHAT_ATTACHMENT_IMAGE_MIME_TYPES, CHAT_ATTACHMENT_MAX_COUNT } from "./constants"

export interface ChatAttachmentReference {
  readonly fileId: string
  readonly sourceMessageId: string
  readonly type: "image" | "document" | "audio" | "video"
  readonly filename: string
  readonly mimeType: string
  readonly bytes: number
}

export interface ChatAttachmentMedia {
  readonly protocol: string
  /** The dedicated OpenRouter adapter has the platform's inline-PDF converter. */
  readonly openRouterDocuments?: boolean
}

const savedAttachmentSource = Schema.Struct({
  type: Schema.Literal(APP_HANDLE),
  id: Schema.String.check(Schema.isUUID()),
  mimeType: Schema.String,
  byteSize: Schema.Number,
})

const ChatAttachmentRetrievalSchema = Schema.Struct({
  type: Schema.Literal("attachment-reference"),
  version: Schema.Literal(1),
  fileId: Schema.String.check(Schema.isUUID()),
  sourceMessageId: Schema.String,
})

/** Only original user uploads on the selected canonical path grant retrieval access. */
export function chatAttachmentCatalogue(history: readonly ChatProjectionRecord[]) {
  const catalogue = new Map<string, ChatAttachmentReference>()
  for (const message of history) {
    if (message.role !== "user" || message.state !== "complete") continue
    for (const part of message.payload.parts) {
      if (
        !Schema.is(Schema.Literals(["image", "document", "audio", "video"]))(part.type) ||
        !Schema.is(savedAttachmentSource)(part.source) ||
        catalogue.has(part.source.id)
      )
        continue
      const metadata = Schema.is(Schema.JsonObject)(part.metadata) ? part.metadata : {}
      catalogue.set(part.source.id, {
        fileId: part.source.id,
        sourceMessageId: message.id,
        type: part.type,
        filename: typeof metadata.filename === "string" ? metadata.filename : "attachment",
        mimeType: part.source.mimeType,
        bytes: part.source.byteSize,
      })
    }
  }
  return [...catalogue.values()]
}

export function chatAttachmentMediaSupported(
  file: ChatAttachmentReference,
  media: ChatAttachmentMedia,
) {
  if (CHAT_ATTACHMENT_IMAGE_MIME_TYPES.includes(file.mimeType)) return true
  if (file.mimeType !== "application/pdf") return false
  return (
    media.openRouterDocuments === true ||
    ["responses", "anthropic-messages", "gemini-generate-content"].includes(media.protocol)
  )
}

function trustedChatAttachmentCall(
  result: ChatProjectionRecord,
  records: ReadonlyMap<string, ChatProjectionRecord>,
) {
  if (result.role !== "tool" || result.state !== "complete" || result.authorTenantUserId) return
  const decision = records.get(result.sourceAssistantMessageId ?? "")
  const call = decision?.payload.parts.find((part) => part.id === result.sourceToolPartId)
  if (
    decision?.role !== "assistant" ||
    decision.state !== "complete" ||
    call?.type !== "tool-call" ||
    call.name !== "read_attachment" ||
    call.executionLocation !== "server_api" ||
    !Schema.is(Schema.Struct({ source: Schema.Literal("chat-attachment") }))(call.declaration) ||
    !Array.isArray(call.targets) ||
    !call.targets.some(
      (target: unknown) =>
        Schema.is(Schema.JsonObject)(target) &&
        target.id === result.responseTargetId &&
        !target.tenantUserId &&
        !target.clientId,
    )
  )
    return
  return call
}

function trustedChatAttachmentResult(
  result: ChatProjectionRecord,
  records: ReadonlyMap<string, ChatProjectionRecord>,
  catalogue: readonly ChatAttachmentReference[],
) {
  const call = trustedChatAttachmentCall(result, records)
  if (!call) return
  const part = result.payload.parts[0]
  if (
    result.payload.parts.length !== 1 ||
    part?.type !== "tool-result" ||
    part.outcome !== "succeeded" ||
    part.toolCallId !== call.toolCallId ||
    !Schema.is(ChatAttachmentRetrievalSchema)(part.output)
  )
    return
  const output = part.output
  const file = catalogue.find(
    (entry) => entry.fileId === output.fileId && entry.sourceMessageId === output.sourceMessageId,
  )
  return file ? { file, output } : undefined
}

/** Expands a verified server result at its saved position, without trusting arbitrary tool JSON. */
export function projectChatAttachmentRetrievals(options: {
  readonly history: readonly ChatProjectionRecord[]
  readonly messages: readonly ModelMessage[]
  readonly catalogue: readonly ChatAttachmentReference[]
  readonly media: ChatAttachmentMedia
}) {
  const records = new Map(options.history.map((record) => [record.id, record]))
  const trustedToolMessageIds = new Set<string>()
  const messages: ModelMessage[] = []
  const documents: ContentPart[] = []
  let documentSource: ModelMessage | undefined
  const flushDocuments = () => {
    if (!documentSource || documents.length === 0) return
    while (documents.length)
      messages.push({
        id: `${documentSource.id}:attachments:${documents.length}`,
        role: "user",
        content: documents.splice(0, CHAT_ATTACHMENT_MAX_COUNT),
        ...(documentSource.metadata ? { metadata: documentSource.metadata } : {}),
      })
    documentSource = undefined
  }
  for (const message of options.messages) {
    if (message.role !== "tool") flushDocuments()
    const metadata: unknown = message.metadata?.astralbeam
    const id = Schema.is(Schema.Struct({ messageId: Schema.String }))(metadata)
      ? metadata.messageId
      : undefined
    const record = id ? records.get(id) : undefined
    const result =
      message.role === "tool" &&
      record &&
      trustedChatAttachmentResult(record, records, options.catalogue)
    if (!result || !chatAttachmentMediaSupported(result.file, options.media)) {
      messages.push(message)
      continue
    }
    const part: ContentPart = {
      type: result.file.mimeType.startsWith("image/") ? "image" : "document",
      source: { type: "file", value: result.file.fileId, mimeType: result.file.mimeType },
      metadata: { filename: result.file.filename },
    }
    const content: ContentPart[] = [{ type: "text", content: JSON.stringify(result.output) }]
    if (part.type === "document" && options.media.openRouterDocuments) {
      documents.push(part)
      documentSource = message
    } else content.push(part)
    messages.push({ ...message, content })
    if (message.id) trustedToolMessageIds.add(message.id)
  }
  flushDocuments()
  return { messages, trustedToolMessageIds }
}

/** Remove only the duplicate shape emitted for our media tool by TanStack AI 1.0.0. */
export function normalizeChatAttachmentRequest(
  body: typeof Schema.JsonObject.Type,
  protocol: string,
) {
  if (protocol !== "gemini-generate-content" || !Array.isArray(body.contents)) return body
  return {
    ...body,
    contents: body.contents.map((entry: typeof Schema.Json.Type) => {
      const content: unknown = entry
      if (!Schema.is(Schema.JsonObject)(content)) return entry
      const parts = content.parts
      if (!Schema.is(Schema.Array(Schema.Json))(parts)) return content
      const last = parts.at(-1)
      if (
        !Schema.is(
          Schema.Struct({
            functionResponse: Schema.Struct({
              name: Schema.Literal("read_attachment"),
              parts: Schema.Array(Schema.Json),
              response: Schema.Struct({ content: Schema.String }),
            }),
          }),
        )(last)
      )
        return content
      const response = last.functionResponse
      const duplicate = [{ text: response.response.content }, ...response.parts]
      if (JSON.stringify(parts.slice(0, -1)) !== JSON.stringify(duplicate)) return content
      // https://github.com/TanStack/ai/blob/v1.0.0/packages/ai-gemini/src/adapters/text.ts
      return { ...content, parts: [last] }
    }),
  }
}
