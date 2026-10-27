import { Effect } from "effect"

import type { ChatModelConfiguration } from "@/lib/model-providers/model-providers.server"
import { ChatThreadInvalid } from "../threads/errors"
import { projectChatModelHistory, type ChatProjectionRecord } from "../threads/projection"
import { ChatFiles, normalizeChatAttachments, type ChatFileScope } from "./attachments"
import { CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "./constants"
import { chatAttachmentCatalogue, projectChatAttachmentRetrievals } from "./retrieval"

/** Recover original media only from the authorized path, keeping provider input separate from history. */
export const prepareChatProviderHistory = Effect.fnUntraced(function* (options: {
  readonly history: readonly ChatProjectionRecord[]
  readonly model: Pick<ChatModelConfiguration, "providerId" | "api" | "modelId" | "providerType">
  readonly webAccessEnabled: boolean
  readonly files: Pick<typeof ChatFiles.Service, "hydrate">
  readonly sandbox: boolean
  readonly scope: ChatFileScope
}) {
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
  const catalogue = chatAttachmentCatalogue(options.history)
  const media = {
    protocol: options.model.api,
    openRouterDocuments: options.model.providerType === "openrouter" && options.webAccessEnabled,
  }
  const selected = projectChatAttachmentRetrievals({
    history: options.history,
    messages,
    catalogue,
    media,
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
  const projected = yield* options.files.hydrate({ scope: options.scope, messages: executable })
  const normalized = normalizeChatAttachments(projected, {
    sandbox: options.sandbox,
    trustedToolMessageIds: selected.trustedToolMessageIds,
  })
  if (normalized.attachments.some((attachment) => attachment.result === "rejected"))
    return yield* new ChatThreadInvalid()
  return {
    projected,
    ...normalized,
    catalogue,
    media,
    remainingBytes:
      CHAT_ATTACHMENT_MAX_TOTAL_BYTES -
      normalized.attachments.reduce((total, file) => total + file.bytes, 0),
  }
})
