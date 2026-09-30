import type { chatParamsFromRequest } from "@tanstack/ai"

import type { ChatAuthTokenPayloadSchema } from "./schemas.ts"

export type ChatParams = Awaited<ReturnType<typeof chatParamsFromRequest>>
export type ChatMessages = ChatParams["messages"]

type ChatAuthTokenPayload = typeof ChatAuthTokenPayloadSchema.Type

export type ChatTenantUser = ChatAuthTokenPayload["user"] & {
  readonly tenant: ChatAuthTokenPayload["tenant"]
}

export interface ChatPrincipal {
  readonly organization: { readonly id: string }
  readonly tenantUser: ChatTenantUser
}
