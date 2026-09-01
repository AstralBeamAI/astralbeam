import type { chatParamsFromRequest } from "@tanstack/ai"

import type { ChatTenantUserSchema } from "@/lib/schemas"

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

/**
 * Sandbox provisioning progress. Streamed as a CUSTOM event because it is the one thing a tool
 * result cannot report in time: the widget needs it while the sandbox is still starting.
 */
export type ChatSandboxStatus = { readonly state: "starting" | "ready" | "error" }

export interface ChatAuthenticationError extends Error {
  code: "invalid_token"
}

export type ChatTenantUser = typeof ChatTenantUserSchema.Type

export interface ChatPrincipal {
  readonly organization: { readonly id: string }
  readonly tenantUser: ChatTenantUser
}
