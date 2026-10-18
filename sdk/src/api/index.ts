import * as generated from "./generated/api.ts"
import type { ApiOptions, JwtOptions } from "./api.ts"

export * from "./generated/api.ts"
export { isAstralBeamApiError } from "./api.ts"
export type {
  ApiKeyOptions,
  ApiOptions,
  ApiRequestOptions,
  AstralBeamApiError,
  AstralBeamApiErrorBody,
  JwtOptions,
} from "./api.ts"

// Preserve the published credential argument position for attachment downloads.
// https://github.com/AstralBeamAI/astralbeam/blob/4c81aaec6/sdk/src/api/generated/api.ts
export function getChatAttachment(
  id: string,
  messageId: string,
  partId: string,
  options: JwtOptions,
  params: generated.GetChatAttachmentParams = {},
) {
  return generated.getChatAttachment(id, messageId, partId, params, options)
}

export function getThreadAttachment(
  tenantId: string,
  id: string,
  messageId: string,
  partId: string,
  options: ApiOptions,
  params: generated.GetThreadAttachmentParams = {},
) {
  return generated.getThreadAttachment(tenantId, id, messageId, partId, params, options)
}

export function getGetChatAttachmentUrl(
  id: string,
  messageId: string,
  partId: string,
  params: generated.GetChatAttachmentParams = {},
) {
  return generated.getGetChatAttachmentUrl(id, messageId, partId, params)
}

export function getGetThreadAttachmentUrl(
  tenantId: string,
  id: string,
  messageId: string,
  partId: string,
  params: generated.GetThreadAttachmentParams = {},
) {
  return generated.getGetThreadAttachmentUrl(tenantId, id, messageId, partId, params)
}
