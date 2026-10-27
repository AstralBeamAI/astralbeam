import type { ModelMessage } from "@tanstack/ai"
import { Effect, Schema } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { ChatThreadInvalid } from "../threads/errors"
import { projectChatModelHistory, type ChatProjectionRecord } from "../threads/projection"
import {
  base64ByteLength,
  ChatFiles,
  normalizeChatAttachments,
  type ChatFileScope,
} from "./attachments"
import { CHAT_ATTACHMENT_MAX_COUNT, CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "./constants"
import {
  chatAttachmentCatalogue,
  projectChatAttachmentRetrievals,
  type ChatAttachmentReference,
} from "./retrieval"

interface ChatProviderHistorySelection {
  readonly history: readonly ChatProjectionRecord[]
  readonly messages: readonly ModelMessage[]
  readonly model: Pick<ChatModelConfiguration, "providerId" | "api" | "modelId" | "providerType">
  readonly webAccessEnabled: boolean
}

export function selectChatProviderHistory(options: ChatProviderHistorySelection) {
  const catalogue = chatAttachmentCatalogue(options.history)
  const selected = projectChatAttachmentRetrievals({
    history: options.history,
    messages: options.messages,
    catalogue,
    media: {
      protocol: options.model.api,
      openRouterDocuments: options.model.providerType === "openrouter" && options.webAccessEnabled,
    },
  })
  const executable = selected.messages.flatMap((message) => {
    if (
      message.role === "user" ||
      (message.id && selected.trustedToolMessageIds.has(message.id)) ||
      !Array.isArray(message.content)
    )
      return [message]
    const content = message.content.filter(
      (part) => !["image", "document", "audio", "video"].includes(part.type),
    )
    return content.length ? [{ ...message, content }] : []
  })
  const bytes = chatProviderHistoryBytes(executable, catalogue)
  return bytes !== null
    ? {
        ...selected,
        messages: executable,
        catalogue,
        remainingBytes: CHAT_ATTACHMENT_MAX_TOTAL_BYTES - bytes,
      }
    : null
}

/** Check aggregate bytes and per-message count before reading any saved file. */
function chatProviderHistoryBytes(
  messages: readonly ModelMessage[],
  catalogue: readonly ChatAttachmentReference[],
) {
  const sizes = new Map(catalogue.map((file) => [file.fileId, file.bytes]))
  let total = 0
  for (const message of messages) {
    let count = 0
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (!["image", "document", "audio", "video"].includes(part.type) || !("source" in part))
        continue
      count++
      if (count > CHAT_ATTACHMENT_MAX_COUNT) return null
      const source: unknown = part.source
      if (!Schema.is(Schema.JsonObject)(source)) return null
      const id = source.type === "file" ? source.value : source.id
      const bytes =
        source.type === "data" && typeof source.value === "string"
          ? base64ByteLength(source.value)
          : typeof id === "string"
            ? sizes.get(id)
            : undefined
      if (bytes === undefined) return null
      total += bytes
      if (total > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) return null
    }
  }
  return total
}

/** Hydrate only the chosen provider context while retaining full-ancestry discovery authority. */
export const prepareChatProviderHistory = Effect.fnUntraced(function* (
  options: Omit<ChatProviderHistorySelection, "messages"> & {
    readonly files: Pick<typeof ChatFiles.Service, "hydrate">
    readonly sandbox: boolean
    readonly scope: ChatFileScope
  },
) {
  const messages = yield* Effect.try({
    try: () =>
      projectChatModelHistory(options.history, {
        providerId: options.model.providerId,
        protocol: options.model.api,
        modelId: options.model.modelId,
        webAccessEnabled: options.webAccessEnabled,
      }),
    catch: () => new ChatThreadInvalid(),
  })
  const selected = selectChatProviderHistory({ ...options, messages })
  if (!selected) return yield* new ChatThreadInvalid()
  const projected = yield* options.files.hydrate({
    scope: options.scope,
    messages: selected.messages,
  })
  const normalized = normalizeChatAttachments(projected, {
    sandbox: options.sandbox,
    trustedToolMessageIds: selected.trustedToolMessageIds,
  })
  if (normalized.attachments.some((attachment) => attachment.result === "rejected"))
    return yield* new ChatThreadInvalid()
  return {
    projected,
    ...normalized,
    catalogue: selected.catalogue,
    remainingBytes: selected.remainingBytes,
  }
})
