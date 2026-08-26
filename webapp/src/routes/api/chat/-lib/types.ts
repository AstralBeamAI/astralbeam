import type { chatParamsFromRequest } from "@tanstack/ai"

export type ChatParams = Awaited<ReturnType<typeof chatParamsFromRequest>>
export type ChatMessages = ChatParams["messages"]

/** How an attachment reaches the model: natively as an image or PDF, or decoded into text. */
export type ChatAttachmentKind = "image" | "pdf" | "text"

/** What became of one attachment on a run, for the debug log. */
export interface ChatAttachmentOutcome {
  filename: string
  mimeType: string
  /** Decoded size; zero for a refused attachment, which is never decoded. */
  bytes: number
  result: ChatAttachmentKind | "rejected"
  reason?: string
}

export type DebugLog = (category: string, summary: string, data?: unknown) => void

export type ChatAuthenticationErrorCode = "invalid_token" | "verifier_not_configured"

export interface ChatAuthenticationError extends Error {
  code: ChatAuthenticationErrorCode
}

export interface ChatUserPrincipal {
  id: string
  name?: string | undefined
  email?: string | undefined
  avatarUrl?: string | undefined
}

export interface ChatTenantPrincipal {
  id: string
  name?: string | undefined
  logoUrl?: string | undefined
}

export type ChatPrincipal =
  | { kind: "guest" }
  | { kind: "authenticated"; user: ChatUserPrincipal; tenant: ChatTenantPrincipal }
