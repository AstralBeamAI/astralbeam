import { createHash } from "node:crypto"

import type { ChatPrincipal } from "./types"

/** Opaque identity for boundaries where tenant-local user IDs alone would collide. */
export function chatPrincipalScope(principal: ChatPrincipal): string {
  return createHash("sha256")
    .update(principal.organization.id)
    .update("\0")
    .update(principal.tenantUser.tenant.id)
    .update("\0")
    .update(principal.tenantUser.id)
    .digest("base64url")
}
