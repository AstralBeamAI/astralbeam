import type { chatParamsFromRequest } from "@tanstack/ai"

export type ChatParams = Awaited<ReturnType<typeof chatParamsFromRequest>>
export type ChatMessages = ChatParams["messages"]

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
